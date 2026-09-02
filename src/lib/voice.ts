// WebRTC voice/video client for `^` voice channels.
//
// Signaling rides over IRC TAGMSGs with the +obsidianirc/rtc tag,
// brokered by obbyircd's voice-channels module to the hosted-backend
// SFU.  We never peer with other users directly -- every track flows
// through the SFU and is ICE/DTLS-SRTP encrypted end-to-end with the
// SFU.
//
// Lifecycle:
//   1. join(serverId, channel)
//      -> JOIN ^channel (so we appear in NAMES)
//      -> TAGMSG ^channel @+obsidianirc/rtc={"type":"join",…}
//   2. SFU replies with {"type":"joined", members, turn}
//      -> we build an RTCPeerConnection with the supplied TURN creds
//      -> getUserMedia + addTrack
//      -> createOffer + send via TAGMSG
//   3. SFU answers with {"type":"answer", sdp}
//      -> setRemoteDescription
//   4. ICE candidates flow both ways via {"type":"ice"} TAGMSGs
//   5. Other peers' tracks arrive via OnTrack
//
// All public surface is the VoiceClient class -- one instance per
// (serverId,channel) join.  The hook in voice/store.ts manages the
// active instance and exposes state to React.

import ircClient from "./ircClient";

export interface VoiceMember {
  nick: string;
  micOn: boolean;
  videoOn: boolean;
  speaking: boolean;
  deafened: boolean;
  screenSharing: boolean;
  // Hand-raise: separate transient flag, propagated via presence
  // like mic/video. Lowered automatically on leave or after the user
  // toggles it off.
  handRaised: boolean;
  // Local-only per-peer volume (0..1). Affects this client's audio
  // sink only; doesn't travel across the wire. 0 == ignore audio.
  volume: number;
  // Local-only connection-quality summary derived from RTCPeerConnection
  // getStats() ticks. "good" / "ok" / "poor" / "unknown".
  quality: "good" | "ok" | "poor" | "unknown";
  // Latest inbound MediaStreamTracks we've received from the SFU,
  // keyed by kind.  An audio element / video element will pick them
  // up via the onTrack subscription below.
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
}

export type VoiceMode = "voice" | "stream";
export type VoiceRole = "streamer" | "viewer";

export type VoiceState =
  | { phase: "idle" }
  | { phase: "joining" }
  | {
      phase: "connected";
      members: Record<string, VoiceMember>;
      // Room mode (voice ^ vs stream $) and the local user's role.
      // Drives the view's choice between "everyone publishes" and the
      // streamer/viewer split layout.
      mode: VoiceMode;
      role: VoiceRole;
      // Nicks of current streamers, oldest first. The first entry is
      // the host (only one who can demote others). In voice rooms this
      // is a snapshot of every present nick.
      streamers: string[];
    }
  | { phase: "failed"; error: string };

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface SignalEnvelope {
  type:
    | "join"
    | "leave"
    | "joined"
    | "offer"
    | "answer"
    | "ice"
    | "presence"
    | "error"
    | "mic"
    | "video"
    | "speaking"
    | "silent"
    | "deaf"
    | "screen"
    | "hand"
    | "react"
    | "promote"
    | "demote"
    | "role";
  channel?: string;
  sdp?: string;
  cand?: string;
  mid?: string;
  mlineidx?: number;
  state?: string;
  kind?: string; // which sub-state (mic|video|screen|hand) when type=presence
  emoji?: string; // floating reaction
  members?: string[];
  member?: string;
  turn?: { urls: string[]; username: string; password: string };
  error?: string;

  // SDP chunking (offer / answer only). The server's CLIENT_TAG_SIZE_LIMIT
  // is 8191 bytes post-IRCv3-escape; a video offer/answer routinely blows
  // past that. sendSignal() splits oversized SDPs into N pieces sharing
  // an "id" with sequential "seq"/"total"; the SFU reassembles before
  // dispatching.
  id?: string;
  seq?: number;
  total?: number;

  // Track-to-nick attribution hint sent alongside any envelope that
  // carries SDP (joined / offer / answer). Pion's emitted SDP doesn't
  // always include a=msid for tracks added mid-session, and Firefox
  // falls back to a browser-generated "{uuid}" stream id in that case
  // so we can't resolve which member a track belongs to from the
  // browser-visible stream/track ids alone.
  tracks?: TrackHint[];

  // Stream-channel ($) bookkeeping. Server sends `mode`/`role`/
  // `streamers` in the "joined" reply and `role` envelopes when
  // promotion/demotion happens.
  mode?: VoiceMode;
  role?: VoiceRole;
  streamers?: string[];
  // Promote/demote target nick (sender is the requesting streamer).
  target?: string;
}

interface TrackHint {
  track_id: string;
  mid?: string;
  member: string;
  kind: string;
}

const RTC_TAG = "+obsidianirc/rtc";

// Mirrors UnrealIRCd's `message_tag_escape` (src/modules/message-tags.c)
// byte-for-byte, which is the canonical IRCv3 message-tag value escape
// table. Single-pass char loop -- avoids chained .replace() ordering
// hazards on payloads that contain escape sequences themselves (e.g.
// SDP carrying "a=fingerprint:..." which has both ';' separators and
// spaces).
function escapeIrcTagValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x3b /* ; */:
        out += "\\:";
        break;
      case 0x20 /* space */:
        out += "\\s";
        break;
      case 0x5c /* \ */:
        out += "\\\\";
        break;
      case 0x0d /* CR */:
        out += "\\r";
        break;
      case 0x0a /* LF */:
        out += "\\n";
        break;
      default:
        out += s[i];
    }
  }
  return out;
}

// Wire-byte cost of one raw SDP character after the JSON.stringify +
// escapeIrcTagValue pipeline. CR/LF go 1 → 3 (JSON: `\r` 2 bytes →
// IRC: `\\r` 3 bytes), `\` goes 1 → 4 (JSON `\\` → IRC `\\\\`), and
// space/`;` go 1 → 2. Used by the SDP chunker to pick slice boundaries
// such that each emitted TAGMSG stays under the server's tag-block
// limit regardless of how dense the SDP is in newlines.
function encodedTagCost(charCode: number): number {
  switch (charCode) {
    case 0x0d /* CR */:
    case 0x0a /* LF */:
      return 3;
    case 0x5c /* \ */:
      return 4;
    case 0x22 /* " */:
      return 2;
    case 0x20 /* space */:
    case 0x3b /* ; */:
    case 0x09 /* tab */:
    case 0x08 /* BS */:
    case 0x0c /* FF */:
      return 2;
    default:
      return 1;
  }
}

// IRCv3 tag-value escaping is reversed by the parser before we see
// it -- ircClient already decodes message tag values, so the tag
// value handed to us is the raw JSON.

export interface VoiceClientOptions {
  serverId: string;
  channel: string;
  selfNick: string;
  onState: (s: VoiceState) => void;
  onError: (e: string) => void;
  /** Fired when a peer (or the local user, echo) sends an emoji
   *  reaction. The view animates the emoji floating up over that
   *  member's tile. */
  onReaction?: (nick: string, emoji: string) => void;
  /** Audio element created by the React layer, used as the sink for
   *  inbound audio tracks.  Created upfront because Safari requires
   *  an attached element for autoplay to kick in. */
  audioSink: HTMLAudioElement;
}

export class VoiceClient {
  private opts: VoiceClientOptions;
  private pc?: RTCPeerConnection;
  private localStream?: MediaStream;
  private screenStream?: MediaStream;
  private members: Record<string, VoiceMember> = {};
  // Map of track-id (as set by the SFU) -> member nick. Populated
  // from any SDP-carrying envelope's `tracks` hint. Used as the
  // primary lookup in attachInboundTrack so we don't depend on the
  // browser's flaky msid handling.
  private trackOwners: Record<string, string> = {};
  // Same map as trackOwners but keyed by transceiver mid -- the only
  // identifier Firefox reliably preserves for tracks added
  // mid-session.
  private midOwners: Record<string, string> = {};
  // ICE candidates that arrived before the first remoteDescription
  // was set. Drained by drainPendingIce() after every successful
  // setRemoteDescription.
  private pendingIce: RTCIceCandidateInit[] = [];
  // Room mode + own role. Default "voice"/"streamer" matches the old
  // ^-channel behavior; overwritten by the SFU's "joined" reply for
  // $-channels where viewers can't publish until promoted.
  private mode: VoiceMode = "voice";
  private role: VoiceRole = "streamer";
  // Snapshot of streamer nicks (oldest first) maintained from the
  // SFU's "joined" + "role" envelopes. Used by the view to know who to
  // render as a streamer tile vs a viewer chip.
  private streamers: string[] = [];
  // Reassembly buffer for chunked offer/answer envelopes pushed by the
  // SFU. Keyed by the envelope's `id` -- each chunk drops its `sdp`
  // slice into `parts[seq]` and we fire the assembled envelope through
  // onSignal once every slot is filled. Mirrors voice.go sendChunked.
  private inboundChunks: Map<
    string,
    {
      base: SignalEnvelope; // first chunk's envelope minus sdp slice
      parts: string[]; // by seq
      filled: number; // count of filled slots
      total: number;
    }
  > = new Map();
  // Per-peer local mute set: nicks whose inbound audio is silenced
  // by toggling the MediaStreamTrack.enabled flag (silences only on
  // this client; the SFU continues to relay the track to others).
  private localMutes = new Set<string>();
  // Connection-quality poll handle.
  private statsTimer?: ReturnType<typeof setInterval>;
  private state: VoiceState = { phase: "idle" };
  private tagmsgUnsub?: () => void;
  // Pending JOIN-echo wait state. Both must be cleared on teardown to
  // stop a torn-down session from firing the SFU "join" or leaking a
  // stale JOIN hook into the next session.
  private joinEchoUnsub?: () => void;
  private joinEchoTimeout?: ReturnType<typeof setTimeout>;
  private speakingTimer?: ReturnType<typeof setInterval>;
  private vadAudioCtx?: AudioContext;
  private isSpeakingNow = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read by future setMicTransient flow; setter is the public surface
  private pttMode = false;
  // Per-peer audio playback sinks. Each member with an inbound audio
  // track gets a dedicated hidden <audio> element so its volume can be
  // controlled independently of other members. Mounted under the shared
  // sink container so a single user-gesture chain unlocks autoplay for
  // all of them.
  private memberAudioSinks: Map<string, HTMLAudioElement> = new Map();

  constructor(opts: VoiceClientOptions) {
    this.opts = opts;
  }

  /** Re-bind the view-side callbacks without tearing the call down.
   *  Used when the React component re-mounts after the user navigated
   *  away and back. Audio sink is owned by voice.ts itself (a hidden
   *  document-level <audio>), so the view doesn't need to pass one. */
  attach(callbacks: {
    onState: (s: VoiceState) => void;
    onError: (e: string) => void;
    onReaction?: (nick: string, emoji: string) => void;
  }): void {
    this.opts = { ...this.opts, ...callbacks };
    // Push current state immediately so the freshly mounted UI doesn't
    // flash "idle" before the next state transition.
    callbacks.onState(this.state);
  }

  getState(): VoiceState {
    return this.state;
  }

  async join(): Promise<void> {
    if (this.state.phase !== "idle") return;
    this.setState({ phase: "joining" });

    // Subscribe to inbound TAGMSGs carrying our tag.
    const handler = (p: {
      serverId: string;
      sender: string;
      channelName: string;
      mtags?: Record<string, string>;
    }) => {
      if (p.serverId !== this.opts.serverId) return;
      if (!p.mtags) return;
      const raw = p.mtags[RTC_TAG];
      if (!raw) return;
      try {
        const env = JSON.parse(raw) as SignalEnvelope;
        this.onSignal(p.sender, p.channelName, env);
      } catch (err) {
        console.warn("voice: bad RTC payload", err);
      }
    };
    ircClient.on("TAGMSG", handler);
    this.tagmsgUnsub = () => ircClient.deleteHook("TAGMSG", handler);

    // Step 1: appear in the IRC channel, then wait for the server's
    // own echoed JOIN before sending the SFU "join" TAGMSG. Without
    // the wait the TAGMSG can race the JOIN on the server side: the
    // session that's actually a member of the channel may not be the
    // same session that just sent the TAGMSG (multi-session
    // persistence migrations), and the channel's +n mode then bounces
    // the signaling line with ERR_CANNOTSENDTOCHAN, leaving the SFU
    // never told the user joined. Waiting for the echo means we only
    // signal once the server confirmed our membership on this
    // connection. Safety timeout sends anyway after 2 s so an old
    // server that doesn't echo cleanly doesn't strand the call.
    const channel = this.opts.channel;
    const selfNick = this.opts.selfNick;
    const sendJoinSignal = () => {
      this.sendSignal({ type: "join", channel });
    };
    let signaled = false;
    const clearJoinEchoWait = () => {
      if (this.joinEchoUnsub) {
        this.joinEchoUnsub();
        this.joinEchoUnsub = undefined;
      }
      if (this.joinEchoTimeout) {
        clearTimeout(this.joinEchoTimeout);
        this.joinEchoTimeout = undefined;
      }
    };
    const joinHandler = (p: { username: string; channelName: string }) => {
      if (signaled) return;
      // IRC nicks are case-insensitive per RFC 1459 -- the server may
      // echo a casing different from this.opts.selfNick.
      if (p.username.toLowerCase() !== selfNick.toLowerCase()) return;
      if (p.channelName.toLowerCase() !== channel.toLowerCase()) return;
      signaled = true;
      clearJoinEchoWait();
      sendJoinSignal();
    };
    ircClient.on("JOIN", joinHandler);
    this.joinEchoUnsub = () => ircClient.deleteHook("JOIN", joinHandler);
    this.joinEchoTimeout = setTimeout(() => {
      if (signaled) return;
      signaled = true;
      clearJoinEchoWait();
      sendJoinSignal();
    }, 2000);

    ircClient.sendRaw(this.opts.serverId, `JOIN ${this.opts.channel}`);
  }

  leave(): void {
    // Even if state is already "idle" we may still have a TAGMSG
    // handler subscribed (e.g. error path called teardown but the
    // owning React effect hadn't unmounted yet, or join was racy).
    // Always run teardown so the unsub fires; only emit leave / PART
    // when there's actually an active session to tear down.
    if (this.state.phase !== "idle") {
      this.sendSignal({ type: "leave", channel: this.opts.channel });
      ircClient.sendRaw(this.opts.serverId, `PART ${this.opts.channel}`);
    }
    this.teardown();
  }

  setDeafened(on: boolean): void {
    if (this.opts.audioSink) this.opts.audioSink.muted = on;
  }

  /** Send a transient emoji reaction visible to everyone in the room.
   *  The server's handleReaction echoes the broadcast back to the
   *  sender too, so we don't manually emit the local copy here -- the
   *  inbound onSignal "react" path renders it for everyone uniformly. */
  sendReaction(emoji: string): void {
    this.sendSignal({ type: "react", emoji });
  }

  /** Toggle the local hand-raised state and tell the rest of the room. */
  setHandRaised(on: boolean): void {
    const selfNick = this.opts.selfNick;
    const m = this.members[selfNick] ?? blankMember(selfNick);
    m.handRaised = on;
    this.members[selfNick] = m;
    this.sendSignal({ type: "hand", state: on ? "on" : "off" });
    this.pushConnected();
  }

  /** Locally mute / unmute a specific peer. Toggles the inbound
   *  audio track's `enabled` flag, which silences playback on this
   *  client without affecting the SFU's relay to other peers. */
  setMemberMuted(nick: string, muted: boolean): void {
    const m = this.members[nick];
    if (!m) return;
    if (muted) this.localMutes.add(nick);
    else this.localMutes.delete(nick);
    m.volume = muted ? 0 : 1;
    if (m.audioTrack) m.audioTrack.enabled = !muted;
    const sink = this.memberAudioSinks.get(nick);
    if (sink) sink.volume = m.volume;
    this.pushConnected();
  }

  /** Set a peer's local playback volume in [0, 1]. Independent of mute
   *  -- adjusting volume above 0 also clears any local-mute flag, and
   *  setting it to 0 marks the peer as locally muted (so the existing
   *  unmute-via-button flow restores to 1). Affects this client only. */
  setMemberVolume(nick: string, volume: number): void {
    const m = this.members[nick];
    if (!m) return;
    const v = Math.max(0, Math.min(1, volume));
    m.volume = v;
    if (v === 0) {
      this.localMutes.add(nick);
      if (m.audioTrack) m.audioTrack.enabled = false;
    } else {
      this.localMutes.delete(nick);
      if (m.audioTrack) m.audioTrack.enabled = true;
    }
    const sink = this.memberAudioSinks.get(nick);
    if (sink) sink.volume = v;
    this.pushConnected();
  }

  /** Push-to-talk: when enabled the mic stays muted by default and
   *  callers can briefly unmute via setMicTransient(true). When
   *  disabled, mic returns to its normal toggled state. */
  setPushToTalk(on: boolean): void {
    this.pttMode = on;
    if (on) this.setMic(false);
  }

  setMic(on: boolean): void {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = on;
    this.sendSignal({ type: "mic", state: on ? "on" : "off" });
  }

  async setVideo(on: boolean): Promise<void> {
    if (!this.pc || !this.localStream) return;
    const selfNick = this.opts.selfNick;
    const selfMember = this.members[selfNick] ?? blankMember(selfNick);
    if (on) {
      try {
        const video = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const track = video.getVideoTracks()[0];
        this.localStream.addTrack(track);
        this.pc.addTrack(track, this.localStream);
        selfMember.videoTrack = track;
        selfMember.videoOn = true;
        this.members[selfNick] = selfMember;
        await this.renegotiate();
      } catch (err) {
        this.opts.onError(`camera: ${err}`);
        return;
      }
    } else {
      for (const t of this.localStream.getVideoTracks()) {
        t.stop();
        this.localStream.removeTrack(t);
      }
      selfMember.videoTrack = undefined;
      selfMember.videoOn = false;
      this.members[selfNick] = selfMember;
      // Renegotiate so the SFU drops the video.
      await this.renegotiate();
    }
    this.sendSignal({ type: "video", state: on ? "on" : "off" });
    this.pushConnected();
  }

  async setScreenShare(on: boolean): Promise<void> {
    if (!this.pc) return;
    const selfNick = this.opts.selfNick;
    const selfMember = this.members[selfNick] ?? blankMember(selfNick);
    if (on) {
      let screen: MediaStream;
      try {
        // Request system/desktop audio along with the video. Browsers
        // that support it (Chrome/Edge desktop with the "Share audio"
        // checkbox; Edge for tab capture) will return audio tracks
        // alongside the video; Firefox / Safari ignore the audio
        // constraint and return video only -- in which case
        // getAudioTracks() is empty and we simply skip the audio
        // addTrack below.
        screen = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch (err) {
        this.opts.onError(`screen: ${err}`);
        return;
      }
      // Re-check pc *after* the await: the screen-picker dialog can
      // sit open for many seconds, during which the call may have
      // been torn down (hangup) or never even existed (race with a
      // failed onJoined). Without this guard we throw "addTrack of
      // undefined" and leak the captured stream.
      if (!this.pc) {
        for (const t of screen.getTracks()) t.stop();
        return;
      }
      this.screenStream = screen;
      const videoTrack = screen.getVideoTracks()[0];
      try {
        this.pc.addTrack(videoTrack, screen);
      } catch (err) {
        for (const t of screen.getTracks()) t.stop();
        this.screenStream = undefined;
        this.opts.onError(`screen: ${err}`);
        return;
      }
      // Add any captured desktop-audio tracks. Wrapped in its own
      // try/catch so a failure here doesn't undo the video addTrack
      // -- if audio mid-publish fails, the user still gets a working
      // screen share, just silent.
      for (const audioTrack of screen.getAudioTracks()) {
        try {
          this.pc.addTrack(audioTrack, screen);
        } catch (err) {
          console.warn("voice: screen audio addTrack failed", err);
        }
      }
      // The video track is the one that fires `ended` when the user
      // hits the browser's "Stop sharing" button -- audio tracks from
      // getDisplayMedia don't fire ended on their own. Tear the whole
      // share down on that single signal.
      videoTrack.onended = () => this.setScreenShare(false);
      // Local self preview: piggy-back onto videoTrack so the
      // existing tile renderer shows what we're sharing. videoOn
      // already covers camera vs. nothing; screenSharing
      // distinguishes the two states for the UI.
      selfMember.videoTrack = videoTrack;
      selfMember.screenSharing = true;
      this.members[selfNick] = selfMember;
      await this.renegotiate();
    } else if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop();
      this.screenStream = undefined;
      // Only clear self.videoTrack if the camera isn't also on.
      if (!this.localStream?.getVideoTracks().length) {
        selfMember.videoTrack = undefined;
      }
      selfMember.screenSharing = false;
      this.members[selfNick] = selfMember;
      await this.renegotiate();
    }
    this.sendSignal({ type: "screen", state: on ? "on" : "off" });
    this.pushConnected();
  }

  /* ------- signaling ------- */

  // Hard ceiling for the on-wire `@<tag>=<value>` block. The ircd's
  // MAXTAGSIZE is 8192; we leave headroom for the ` TAGMSG <channel>\r\n`
  // suffix and small estimation slop in encodedTagCost().
  private static WIRE_BUDGET = 7800;

  private sendSignal(env: SignalEnvelope) {
    if (
      (env.type === "offer" || env.type === "answer") &&
      env.sdp &&
      this.wireSize(env) > VoiceClient.WIRE_BUDGET
    ) {
      this.sendChunkedSignal(env);
      return;
    }
    this.emitSignal(env);
  }

  private emitSignal(env: SignalEnvelope) {
    const json = JSON.stringify(env);
    const escaped = escapeIrcTagValue(json);
    ircClient.sendRaw(
      this.opts.serverId,
      `@${RTC_TAG}=${escaped} TAGMSG ${this.opts.channel}`,
    );
  }

  // Predict the wire size of `@<tag>=<value>` for a given envelope.
  private wireSize(env: SignalEnvelope): number {
    return RTC_TAG.length + 2 + escapeIrcTagValue(JSON.stringify(env)).length;
  }

  // SDP carries CR/LF (each 1 byte → 3 on the wire after JSON-escape +
  // IRC-tag-escape) and many spaces (1 → 2), so a fixed raw-byte chunk
  // size doesn't predict on-wire size accurately. Slice the SDP using
  // per-character encoded cost so each chunk's resulting IRC line stays
  // under WIRE_BUDGET regardless of the SDP's character distribution.
  private sendChunkedSignal(env: SignalEnvelope) {
    const sdp = env.sdp ?? "";
    const id = randomChunkId();

    // Wire cost of everything except the SDP slice: envelope JSON with
    // the slice replaced by an empty string. Use total=999 as a generous
    // upper bound on the digit count we'll embed.
    const overhead = this.wireSize({
      ...env,
      sdp: "",
      id,
      seq: 999,
      total: 999,
    });
    const sliceBudget = VoiceClient.WIRE_BUDGET - overhead;

    const slices: string[] = [];
    let start = 0;
    let cost = 0;
    for (let i = 0; i < sdp.length; i++) {
      const c = encodedTagCost(sdp.charCodeAt(i));
      if (cost + c > sliceBudget && i > start) {
        slices.push(sdp.slice(start, i));
        start = i;
        cost = 0;
      }
      cost += c;
    }
    if (start < sdp.length) slices.push(sdp.slice(start));

    const total = slices.length;
    for (let seq = 0; seq < total; seq++) {
      this.emitSignal({ ...env, sdp: slices[seq], id, seq, total });
    }
  }

  private async onSignal(sender: string, _target: string, env: SignalEnvelope) {
    // Reassembly: SFU-pushed offer/answer SDPs above the wire-budget
    // arrive as N chunks sharing an `id`. Buffer until complete, then
    // continue dispatch with the assembled SDP.
    let signal = env;
    if (
      signal.id &&
      signal.total !== undefined &&
      signal.seq !== undefined &&
      signal.total > 1
    ) {
      const slot = this.inboundChunks.get(signal.id);
      if (!slot) {
        const fresh = {
          base: { ...signal, sdp: undefined },
          parts: new Array<string>(signal.total),
          filled: 0,
          total: signal.total,
        };
        fresh.parts[signal.seq] = signal.sdp ?? "";
        fresh.filled = 1;
        this.inboundChunks.set(signal.id, fresh);
        if (fresh.filled < fresh.total) return;
        this.inboundChunks.delete(signal.id);
        signal = { ...fresh.base, sdp: fresh.parts.join("") };
      } else {
        if (slot.parts[signal.seq] === undefined) {
          slot.parts[signal.seq] = signal.sdp ?? "";
          slot.filled++;
        }
        // Track hints can ride along with chunk 0 only -- merge them
        // into the buffered base envelope rather than dropping them.
        if (
          signal.tracks &&
          (!slot.base.tracks || slot.base.tracks.length === 0)
        ) {
          slot.base.tracks = signal.tracks;
        }
        if (slot.filled < slot.total) return;
        this.inboundChunks.delete(signal.id);
        signal = { ...slot.base, sdp: slot.parts.join("") };
      }
    }

    // Any SDP-carrying envelope can ship a tracks-hint map. Merge it
    // into trackOwners so attachInboundTrack can resolve incoming
    // remote tracks to the right member without relying on browser
    // msid behavior.
    if (signal.tracks) {
      for (const h of signal.tracks) {
        this.trackOwners[h.track_id] = h.member;
        if (h.mid) this.midOwners[h.mid] = h.member;
      }
    }
    switch (signal.type) {
      case "joined":
        await this.onJoined(signal);
        break;
      case "answer":
        if (signal.sdp && this.pc) {
          await this.pc.setRemoteDescription({
            type: "answer",
            sdp: signal.sdp,
          });
          await this.drainPendingIce();
        }
        break;
      case "offer":
        // Server-initiated renegotiation: SFU pushes an offer when it
        // adds a new remote sender to our PC (e.g. another peer turned
        // on video / screen share). We always answer; the client never
        // initiates an SFU-bound offer except via this.renegotiate().
        if (signal.sdp && this.pc) {
          try {
            await this.pc.setRemoteDescription({
              type: "offer",
              sdp: signal.sdp,
            });
            await this.drainPendingIce();
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.sendSignal({ type: "answer", sdp: answer.sdp ?? "" });
          } catch (err) {
            console.warn("voice: server-pushed offer failed", err);
          }
        }
        break;
      case "ice":
        if (signal.cand && this.pc) {
          // Buffer ICE that arrives before the first remoteDescription
          // is set (otherwise pion's eager candidate emit + IRC's
          // arbitrary delivery order can race ahead of the answer/
          // offer SDP and trip "DOMException: No remoteDescription").
          if (!this.pc.remoteDescription) {
            this.pendingIce.push({
              candidate: signal.cand,
              sdpMid: signal.mid ?? null,
              sdpMLineIndex: signal.mlineidx ?? null,
            });
          } else {
            try {
              await this.pc.addIceCandidate({
                candidate: signal.cand,
                sdpMid: signal.mid ?? null,
                sdpMLineIndex: signal.mlineidx ?? null,
              });
            } catch (err) {
              console.warn("voice: addIceCandidate failed", err);
            }
          }
        }
        break;
      case "presence":
        this.applyPresence(signal);
        break;
      case "react":
        if (signal.member && signal.emoji) {
          this.opts.onReaction?.(signal.member, signal.emoji);
        }
        break;
      case "role":
        if (signal.member && signal.role) {
          await this.applyRoleChange(signal.member, signal.role);
        }
        break;
      case "error":
        // Soft errors (e.g. "max 4 streamers" from a rejected promote)
        // shouldn't kill the call -- only fail the state if there's
        // no PC yet, i.e. the join itself errored. Anything else gets
        // logged and surfaced via onError so the UI can toast it.
        if (!this.pc) {
          this.setState({ phase: "failed", error: signal.error ?? "unknown" });
          this.teardown();
        } else if (signal.error) {
          this.opts.onError(signal.error);
        }
        break;
    }
  }

  /** SFU told us a member's role changed (promote/demote, or auto-
   *  promotion after the host left). Update the streamer list, and if
   *  it's our own promotion, capture the mic and renegotiate so we
   *  can actually publish. Demotion of self stops/removes our local
   *  tracks. */
  private async applyRoleChange(member: string, role: VoiceRole) {
    if (role === "streamer") {
      if (!this.streamers.includes(member)) this.streamers.push(member);
    } else {
      this.streamers = this.streamers.filter((n) => n !== member);
    }
    if (member === this.opts.selfNick) {
      const wasStreamer = this.role === "streamer";
      this.role = role;
      if (role === "streamer" && !wasStreamer) {
        await this.captureMicAndRenegotiate();
      } else if (role === "viewer" && wasStreamer) {
        await this.releaseLocalMedia();
      }
    }
    this.pushConnected();
  }

  /** First-time mic capture for a freshly-promoted viewer. Mirrors the
   *  initial-join branch in onJoined but runs against an existing PC,
   *  so we addTrack + renegotiate instead of building from scratch. */
  private async captureMicAndRenegotiate(): Promise<void> {
    if (!this.pc || this.localStream) return;
    let local: MediaStream;
    try {
      local = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (err) {
      this.opts.onError(`microphone: ${err}`);
      return;
    }
    this.localStream = local;
    for (const t of local.getAudioTracks()) this.pc.addTrack(t, local);
    this.startVAD(local);
    await this.renegotiate();
  }

  /** Stop and remove all local publishing tracks (mic + camera +
   *  screen). Used when self is demoted back to viewer; fire a
   *  renegotiate so the SFU drops our senders. */
  private async releaseLocalMedia(): Promise<void> {
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = undefined;
    }
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop();
      this.screenStream = undefined;
    }
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = undefined;
    }
    if (this.vadAudioCtx) {
      void this.vadAudioCtx.close();
      this.vadAudioCtx = undefined;
    }
    if (this.pc) {
      // Remove every sender; viewers don't publish anything.
      for (const s of this.pc.getSenders()) {
        try {
          this.pc.removeTrack(s);
        } catch {}
      }
      await this.renegotiate();
    }
  }

  /** Streamer-host action: promote a viewer to co-streamer. Server
   *  enforces the 4-streamer cap and oper authorization; on success
   *  every client receives a "role" envelope. */
  promote(target: string): void {
    if (this.role !== "streamer") return;
    this.sendSignal({ type: "promote", target });
  }

  /** Demote a streamer back to viewer. Self-demotion always allowed;
   *  demoting others is host-only (enforced server-side). */
  demote(target?: string): void {
    if (this.role !== "streamer") return;
    this.sendSignal({
      type: "demote",
      target: target ?? this.opts.selfNick,
    });
  }

  private async onJoined(env: SignalEnvelope) {
    // Re-entrance guard: a duplicate "joined" envelope (e.g. server
    // re-issued one after a transient failure, or a leaked handler
    // from a previous VoiceClient instance) must not spawn a second
    // RTCPeerConnection. The old PC's ICE gatherer would otherwise
    // keep emitting candidates forever, flooding the channel.
    if (this.pc) {
      console.warn("voice: ignoring duplicate 'joined' envelope");
      return;
    }
    // Stream-channel bookkeeping arrives in "joined". Defaults stay
    // voice/streamer for ^-channels (server omits these fields).
    this.mode = env.mode ?? "voice";
    this.role = env.role ?? "streamer";
    this.streamers = [...(env.streamers ?? [])];
    if (
      this.mode === "stream" &&
      !this.streamers.includes(this.opts.selfNick) &&
      this.role === "streamer"
    ) {
      // Server already counts us; this is a defense-in-depth so the
      // initial UI doesn't render with the host missing.
      this.streamers.push(this.opts.selfNick);
    }
    const iceServers: IceServerConfig[] = [
      { urls: "stun:stun.l.google.com:19302" },
    ];
    if (env.turn) {
      iceServers.push({
        urls: env.turn.urls,
        username: env.turn.username,
        credential: env.turn.password,
      });
    }
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.sendSignal({
        type: "ice",
        cand: e.candidate.candidate,
        mid: e.candidate.sdpMid ?? undefined,
        mlineidx: e.candidate.sdpMLineIndex ?? undefined,
      });
    };
    pc.ontrack = (e) => {
      this.attachInboundTrack(e.track, e.streams[0], e.transceiver?.mid);
    };

    // Viewers in stream channels never publish: skip getUserMedia,
    // skip addTrack, skip VAD. They get the regular receive-only PC
    // and can chat via the standard IRC channel input. If they're
    // promoted later, promoteToStreamer() captures the mic and
    // renegotiates.
    if (this.role === "streamer") {
      let local: MediaStream;
      try {
        local = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (err) {
        this.setState({ phase: "failed", error: `microphone: ${err}` });
        this.teardown();
        return;
      }
      this.localStream = local;
      for (const t of local.getAudioTracks()) {
        pc.addTrack(t, local);
      }
      this.startVAD(local);
    }

    // Pre-populate the member map from the join reply.
    const members: Record<string, VoiceMember> = {};
    for (const m of env.members ?? []) {
      members[m] = blankMember(m);
    }
    members[this.opts.selfNick] = blankMember(this.opts.selfNick);
    this.members = members;
    this.pushConnected();
    this.startStatsPump();

    // Initial offer.
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    this.sendSignal({ type: "offer", sdp: offer.sdp ?? "" });
  }

  private async renegotiate() {
    if (!this.pc) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ type: "offer", sdp: offer.sdp ?? "" });
  }

  private attachInboundTrack(
    track: MediaStreamTrack,
    stream: MediaStream | undefined,
    mid: string | null | undefined,
  ) {
    // Resolution order (most-reliable first):
    //   1. transceiver.mid -- preserved across all browsers and
    //      directly tied to the SDP m-line our server pushed.
    //   2. SFU-supplied trackOwners hint (track.id -> nick).
    //   3. MediaStream.id -- works when the browser honors a=msid
    //      (Firefox doesn't, for tracks added mid-session).
    //   4. track.id prefix split -- "<nick>-audio" / "<nick>-video".
    let nick: string | null = null;
    if (mid && this.midOwners[mid]) {
      nick = this.midOwners[mid];
    } else if (track.id && this.trackOwners[track.id]) {
      nick = this.trackOwners[track.id];
    } else {
      const sid = stream?.id;
      if (sid && this.members[sid]) {
        nick = sid;
      } else if (track.id) {
        const dash = track.id.lastIndexOf("-");
        const prefix = dash > 0 ? track.id.slice(0, dash) : track.id;
        if (this.members[prefix]) nick = prefix;
      }
    }
    if (!nick) {
      console.warn("voice: ignoring inbound track with no known owner", {
        mid,
        streamId: stream?.id,
        trackId: track.id,
        knownMembers: Object.keys(this.members),
        knownTrackOwners: Object.keys(this.trackOwners),
        knownMidOwners: Object.keys(this.midOwners),
      });
      return;
    }
    // Defense-in-depth: never play our own audio back through the
    // shared sink. The SFU is supposed to skip the publisher in fan-out,
    // but a stale peer (e.g. nick-collision rename leaving an old entry
    // behind) could still relay self-audio in. Drop it before it reaches
    // the audio element.
    if (nick === this.opts.selfNick) {
      return;
    }
    // Make sure the owner exists in members even if presence raced
    // ahead of (or behind) the track delivery.
    if (!this.members[nick]) {
      this.members[nick] = blankMember(nick);
    }
    const member = this.members[nick];
    if (track.kind === "audio") {
      member.audioTrack = track;
      // Honor any pre-existing local-mute the user toggled before
      // this peer's audio track actually arrived.
      if (this.localMutes.has(nick)) {
        track.enabled = false;
        member.volume = 0;
      }
    } else if (track.kind === "video") {
      member.videoTrack = track;
    }
    this.members[nick] = member;

    // Pipe inbound audio through a per-peer hidden <audio> so each
    // member's volume can be adjusted independently. We still keep the
    // shared sink mounted under the document body to inherit the same
    // user-gesture autoplay grant, but actual playback is per-peer.
    if (track.kind === "audio") {
      // Make sure the shared sink exists in the DOM so the autoplay
      // gesture chain stays intact across reconnects.
      void this.opts.audioSink;
      let sink = this.memberAudioSinks.get(nick);
      if (!sink) {
        sink = document.createElement("audio");
        sink.autoplay = true;
        sink.style.display = "none";
        sink.setAttribute("data-obby-voice-peer", nick);
        document.body.appendChild(sink);
        this.memberAudioSinks.set(nick, sink);
      }
      const stream = new MediaStream([track]);
      sink.srcObject = stream;
      sink.volume = member.volume;
      sink.play().catch(() => {});
    }

    this.pushConnected();
  }

  private applyPresence(env: SignalEnvelope) {
    if (!env.member) return;
    const m = this.members[env.member] ?? blankMember(env.member);
    if (env.state === "joined") {
      this.members[env.member] = m;
      // For stream channels, the SFU sends `role` alongside the
      // presence so the streamer list stays accurate as new viewers
      // arrive.
      if (env.role === "streamer" && !this.streamers.includes(env.member)) {
        this.streamers.push(env.member);
      }
    } else if (env.state === "left") {
      delete this.members[env.member];
      this.streamers = this.streamers.filter((n) => n !== env.member);
      const sink = this.memberAudioSinks.get(env.member);
      if (sink) {
        sink.srcObject = null;
        sink.remove();
        this.memberAudioSinks.delete(env.member);
      }
    } else if (env.state === "on" || env.state === "off") {
      // mic / video / screen / hand toggles arrive as state on/off.
      // The Kind field carries which specific control changed (the
      // envelope Type itself is "presence" because that's what
      // onSignal dispatched on).
      const which = env.kind;
      if (which === "mic") m.micOn = env.state === "on";
      else if (which === "video") m.videoOn = env.state === "on";
      else if (which === "screen") m.screenSharing = env.state === "on";
      else if (which === "hand") m.handRaised = env.state === "on";
      this.members[env.member] = m;
    } else if (env.state === "speaking" || env.state === "silent") {
      m.speaking = env.state === "speaking";
      this.members[env.member] = m;
    } else if (env.state === "deaf-on" || env.state === "deaf-off") {
      m.deafened = env.state === "deaf-on";
      this.members[env.member] = m;
    }
    this.pushConnected();
  }

  /* ------- VAD: emit speaking / silent on threshold cross ------- */

  private startVAD(stream: MediaStream) {
    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.vadAudioCtx = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastChange = 0;
      this.speakingTimer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        const avg = sum / data.length;
        const speaking = avg > 25; // empirical threshold
        const now = Date.now();
        if (speaking !== this.isSpeakingNow && now - lastChange > 200) {
          this.isSpeakingNow = speaking;
          lastChange = now;
          this.sendSignal({
            type: speaking ? "speaking" : "silent",
            state: speaking ? "speaking" : "silent",
          });
        }
      }, 100);
    } catch (err) {
      // VAD is a nice-to-have; if AudioContext fails we just don't
      // emit speaking events.
      console.warn("voice: VAD setup failed", err);
    }
  }

  private async drainPendingIce(): Promise<void> {
    if (!this.pc || this.pendingIce.length === 0) return;
    const queue = this.pendingIce;
    this.pendingIce = [];
    for (const c of queue) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (err) {
        console.warn("voice: drained ICE failed", err);
      }
    }
  }

  private setState(next: VoiceState) {
    this.state = next;
    this.opts.onState(next);
  }

  // Build a fresh "connected" state from the current members map plus
  // the room-mode bookkeeping. Use this everywhere instead of inline
  // setState({ phase: "connected", members: {...} }) so role/mode/
  // streamers stay in sync.
  private pushConnected(): void {
    this.setState({
      phase: "connected",
      members: { ...this.members },
      mode: this.mode,
      role: this.role,
      streamers: [...this.streamers],
    });
  }

  private startStatsPump(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        // Map ssrc/track-id -> packet-loss ratio computed from
        // inbound-rtp reports. Then attribute to a member via the
        // trackOwners map (track id) or stream-id fallback. Each peer
        // gets a quality label from the worst stream associated with
        // them.
        const perTrack: Record<string, { lost: number; total: number }> = {};
        stats.forEach((report) => {
          if (
            report.type === "inbound-rtp" &&
            typeof report.trackIdentifier === "string"
          ) {
            const tid = report.trackIdentifier as string;
            const lost = (report.packetsLost as number) ?? 0;
            const recv = (report.packetsReceived as number) ?? 0;
            const total = lost + recv;
            if (total > 0) perTrack[tid] = { lost, total };
          }
        });
        let dirty = false;
        for (const [trackId, owner] of Object.entries(this.trackOwners)) {
          const m = this.members[owner];
          if (!m) continue;
          const stat = perTrack[trackId];
          if (!stat) continue;
          const ratio = stat.lost / Math.max(1, stat.total);
          const next: VoiceMember["quality"] =
            ratio < 0.02 ? "good" : ratio < 0.08 ? "ok" : "poor";
          if (m.quality !== next) {
            m.quality = next;
            dirty = true;
          }
        }
        if (dirty) {
          this.pushConnected();
        }
      } catch {
        // ignore -- transient errors during teardown etc.
      }
    }, 3000);
  }

  private teardown() {
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = undefined;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
    if (this.vadAudioCtx) {
      void this.vadAudioCtx.close();
      this.vadAudioCtx = undefined;
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = undefined;
    }
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop();
      this.screenStream = undefined;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = undefined;
    }
    if (this.tagmsgUnsub) {
      this.tagmsgUnsub();
      this.tagmsgUnsub = undefined;
    }
    if (this.joinEchoUnsub) {
      this.joinEchoUnsub();
      this.joinEchoUnsub = undefined;
    }
    if (this.joinEchoTimeout) {
      clearTimeout(this.joinEchoTimeout);
      this.joinEchoTimeout = undefined;
    }
    for (const sink of this.memberAudioSinks.values()) {
      sink.srcObject = null;
      sink.remove();
    }
    this.memberAudioSinks.clear();
    this.members = {};
    this.trackOwners = {};
    this.midOwners = {};
    this.localMutes.clear();
    this.pendingIce = [];
    this.setState({ phase: "idle" });
  }
}

function randomChunkId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function blankMember(nick: string): VoiceMember {
  return {
    nick,
    micOn: false,
    videoOn: false,
    speaking: false,
    deafened: false,
    screenSharing: false,
    handRaised: false,
    volume: 1,
    quality: "unknown",
  };
}

/* =====================================================================
 * Live-call registry
 *
 * The React VoiceChannelView mounts/unmounts whenever the user
 * navigates between channels. If the VoiceClient lifecycle were tied
 * to the component lifecycle, every nav round-trip would PART/JOIN the
 * voice channel and trip the server's join-throttle ("too many joins,
 * please wait a while").
 *
 * Keep one VoiceClient per (server, channel) alive at module scope.
 * Views acquire/release; the call only actually disconnects when
 * release() is called explicitly (e.g. from the hangup button) or the
 * underlying IRC connection drops.
 * ===================================================================== */

let sharedAudioSink: HTMLAudioElement | null = null;

function getSharedAudioSink(): HTMLAudioElement {
  if (sharedAudioSink) return sharedAudioSink;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.style.display = "none";
  el.setAttribute("data-obby-voice", "true");
  document.body.appendChild(el);
  sharedAudioSink = el;
  return el;
}

const liveClients = new Map<string, VoiceClient>();

function clientKey(serverId: string, channel: string): string {
  return `${serverId}\x00${channel}`;
}

export interface AcquireOptions {
  serverId: string;
  channel: string;
  selfNick: string;
  onState: (s: VoiceState) => void;
  onError: (e: string) => void;
  onReaction?: (nick: string, emoji: string) => void;
}

export function acquireVoiceClient(opts: AcquireOptions): VoiceClient {
  const key = clientKey(opts.serverId, opts.channel);
  const existing = liveClients.get(key);
  if (existing) {
    existing.attach({
      onState: opts.onState,
      onError: opts.onError,
      onReaction: opts.onReaction,
    });
    return existing;
  }
  const c = new VoiceClient({
    ...opts,
    audioSink: getSharedAudioSink(),
  });
  liveClients.set(key, c);
  void c.join();
  return c;
}

export function releaseVoiceClient(serverId: string, channel: string): void {
  const key = clientKey(serverId, channel);
  const c = liveClients.get(key);
  if (!c) return;
  c.leave();
  liveClients.delete(key);
}

export function hasActiveVoiceClient(
  serverId: string,
  channel: string,
): boolean {
  return liveClients.has(clientKey(serverId, channel));
}

/** Drop all live calls -- call when the IRC connection itself drops,
 *  or on full client logout, so we don't leak peer connections. */
export function shutdownAllVoiceClients(): void {
  for (const c of liveClients.values()) c.leave();
  liveClients.clear();
}
