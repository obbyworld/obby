// Discord-style voice channel UI. Mounted in place of ChatArea when
// the user has selected a `^channel`. Owns one VoiceClient per
// (server, channel) and renders the participant grid + controls.
//
// Audio playback is funneled through a single hidden <audio> element
// owned by voice.ts so Safari's autoplay policies cooperate; video
// is rendered per-tile via a <video> bound to the inbound
// MediaStreamTrack.

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaCircle,
  FaDesktop,
  FaHandPaper,
  FaMicrophone,
  FaMicrophoneSlash,
  FaPhoneSlash,
  FaVideo,
  FaVideoSlash,
  FaVolumeMute,
  FaVolumeUp,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import {
  acquireVoiceClient,
  releaseVoiceClient,
  type VoiceClient,
  type VoiceMember,
  type VoiceState,
} from "../../lib/voice";
import useStore from "../../store";

interface Props {
  serverId: string;
  channelName: string;
}

// Mirrors `streamMaxStreamers` in hosted-backend/voice.go. The server
// is the source of truth; this is just for the "X/4 streaming" header
// label.
const streamMaxStreamers = 4;

export const VoiceChannelView: React.FC<Props> = ({
  serverId,
  channelName,
}) => {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [pttMode, setPttMode] = useState(false);
  // Nick of the currently spotlighted member, or null for grid view.
  const [focusNick, setFocusNick] = useState<string | null>(null);
  // Per-member ephemeral reactions: each entry animates briefly then is dropped.
  const [reactions, setReactions] = useState<
    Array<{ id: number; nick: string; emoji: string }>
  >([]);
  const reactionIdRef = useRef(0);
  const clientRef = useRef<VoiceClient | null>(null);

  const pushReaction = useCallback((nick: string, emoji: string) => {
    const id = ++reactionIdRef.current;
    setReactions((rs) => [...rs, { id, nick, emoji }]);
    setTimeout(() => {
      setReactions((rs) => rs.filter((r) => r.id !== id));
    }, 2400);
  }, []);

  // Self nick from the IRC client.
  const selfNick = useMemo(() => {
    const u = ircClient.getCurrentUser(serverId);
    return u?.username || "you";
  }, [serverId]);

  const selectChannel = useStore((s) => s.selectChannel);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    const client = acquireVoiceClient({
      serverId,
      channel: channelName,
      selfNick,
      onState: (s) => setState(s),
      onError: (e) => setError(e),
      onReaction: (nick, emoji) => pushReaction(nick, emoji),
    });
    clientRef.current = client;
    setState(client.getState());
    return () => {
      clientRef.current = null;
    };
  }, [serverId, channelName, selfNick]);

  // Push-to-talk: while pttMode is on, mic is muted by default and
  // pressing/holding Space unmutes briefly. Releasing re-mutes.
  useEffect(() => {
    if (!pttMode) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      clientRef.current?.setMic(true);
      setMicOn(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      clientRef.current?.setMic(false);
      setMicOn(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [pttMode]);

  const onToggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    clientRef.current?.setMic(next);
  };
  const onToggleVideo = () => {
    const next = !videoOn;
    setVideoOn(next);
    void clientRef.current?.setVideo(next);
  };
  const onToggleScreen = () => {
    const next = !screenOn;
    setScreenOn(next);
    void clientRef.current?.setScreenShare(next);
  };
  const onToggleDeafen = () => {
    const next = !deafened;
    setDeafened(next);
    clientRef.current?.setDeafened(next);
  };
  const onToggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    clientRef.current?.setHandRaised(next);
  };
  const onTogglePtt = () => {
    const next = !pttMode;
    setPttMode(next);
    clientRef.current?.setPushToTalk(next);
    // Going into PTT instantly mutes; coming out leaves mic in its
    // last manual state, defaulting to muted to avoid surprises.
    if (next) {
      setMicOn(false);
      clientRef.current?.setMic(false);
    }
  };
  const onLeave = () => {
    releaseVoiceClient(serverId, channelName);
    clientRef.current = null;
    const srv = useStore.getState().servers.find((s) => s.id === serverId);
    const firstText = srv?.channels.find((c) => c.name.startsWith("#"));
    if (firstText) selectChannel(firstText.id);
  };

  const setMemberMuted = useCallback((nick: string, muted: boolean) => {
    clientRef.current?.setMemberMuted(nick, muted);
  }, []);

  const setMemberVolume = useCallback((nick: string, volume: number) => {
    clientRef.current?.setMemberVolume(nick, volume);
  }, []);

  const members =
    state.phase === "connected" ? Object.values(state.members) : [];
  const mode = state.phase === "connected" ? state.mode : "voice";
  const role = state.phase === "connected" ? state.role : "streamer";
  const streamerNicks = state.phase === "connected" ? state.streamers : [];
  const isStreamRoom = mode === "stream";
  const isStreamer = role === "streamer";
  const isHost = isStreamRoom && streamerNicks[0] === selfNick;
  // Streamer tiles: in a $-room only members in the streamer list show
  // up in the main grid. Voice rooms render every member as before.
  const streamerMembers = isStreamRoom
    ? members.filter((m) => streamerNicks.includes(m.nick))
    : members;
  const viewerMembers = isStreamRoom
    ? members.filter((m) => !streamerNicks.includes(m.nick))
    : [];

  // Auto-pop focus when the focused member leaves the call.
  useEffect(() => {
    if (focusNick && !members.find((m) => m.nick === focusNick)) {
      setFocusNick(null);
    }
  }, [focusNick, members]);

  const focusMember =
    focusNick != null ? members.find((m) => m.nick === focusNick) : null;
  // Spotlight pulls from the streamer-only set in $-rooms so viewers
  // can never get focused (they have no media to render anyway).
  const focusPool = streamerMembers;
  const sideMembers = focusMember
    ? focusPool.filter((m) => m.nick !== focusMember.nick)
    : focusPool;

  // Voice-specific status banner: rendered above the grid only while the
  // connection is mid-flight or failed. The channel name + topic live
  // in the main ChatHeader at the top of the panel, so there's no need
  // for a second header here.
  const statusBanner =
    state.phase === "joining"
      ? "Connecting…"
      : state.phase === "failed"
        ? `Connection failed: ${state.error}`
        : null;

  return (
    <div className="w-full flex flex-col bg-discord-dark-200">
      {(statusBanner || isStreamRoom || focusMember) && (
        <div className="px-4 py-1 border-b border-discord-dark-300 flex items-center justify-between gap-4 text-xs">
          <div className="text-discord-text-muted truncate min-w-0">
            {statusBanner}
            {!statusBanner && isStreamRoom && state.phase === "connected" && (
              <>
                <span className="px-1.5 py-0.5 rounded bg-discord-blue text-white mr-2">
                  {role}
                </span>
                {streamerMembers.length}/{streamMaxStreamers} streaming ·{" "}
                {viewerMembers.length} watching
              </>
            )}
          </div>
          {focusMember && (
            <button
              type="button"
              onClick={() => setFocusNick(null)}
              className="px-2 py-0.5 rounded bg-discord-dark-300 text-discord-text-normal hover:bg-discord-dark-400 flex-shrink-0"
            >
              Exit spotlight
            </button>
          )}
        </div>
      )}

      <main className="p-4 flex flex-col gap-3">
        {focusMember ? (
          <>
            <div className="flex-1 min-h-0">
              <ParticipantTile
                key={focusMember.nick}
                member={focusMember}
                isSelf={focusMember.nick === selfNick}
                selfMicOn={micOn}
                onClick={() => setFocusNick(null)}
                onSetMuted={setMemberMuted}
                onSetVolume={setMemberVolume}
                reactions={reactions
                  .filter((r) => r.nick === focusMember.nick)
                  .map((r) => ({ id: r.id, emoji: r.emoji }))}
                large
              />
            </div>
            {sideMembers.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 flex-shrink-0">
                {sideMembers.map((m) => (
                  <div key={m.nick} className="w-40 flex-shrink-0">
                    <ParticipantTile
                      member={m}
                      isSelf={m.nick === selfNick}
                      selfMicOn={micOn}
                      onClick={() => setFocusNick(m.nick)}
                      onSetMuted={setMemberMuted}
                      onSetVolume={setMemberVolume}
                      reactions={reactions
                        .filter((r) => r.nick === m.nick)
                        .map((r) => ({ id: r.id, emoji: r.emoji }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="overflow-y-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {streamerMembers.map((m) => (
                <ParticipantTile
                  key={m.nick}
                  member={m}
                  isSelf={m.nick === selfNick}
                  selfMicOn={micOn}
                  onClick={() => setFocusNick(m.nick)}
                  onSetMuted={setMemberMuted}
                  onSetVolume={setMemberVolume}
                  reactions={reactions
                    .filter((r) => r.nick === m.nick)
                    .map((r) => ({ id: r.id, emoji: r.emoji }))}
                />
              ))}
            </div>
            {state.phase === "connected" &&
              streamerMembers.length === 0 &&
              !isStreamRoom && (
                <p className="text-discord-text-muted text-sm italic mt-8 text-center">
                  Just you for now. Tell someone to /join {channelName} to chat.
                </p>
              )}
            {isStreamRoom && (
              <div className="mt-6">
                <h3 className="text-discord-text-muted text-xs uppercase mb-2">
                  Viewers ({viewerMembers.length})
                </h3>
                {viewerMembers.length === 0 ? (
                  <p className="text-xs text-discord-text-muted italic">
                    No viewers yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {viewerMembers.map((v) => (
                      <span
                        key={v.nick}
                        className="px-2 py-1 rounded bg-discord-dark-300 text-xs text-discord-text-normal flex items-center gap-2"
                      >
                        {v.nick}
                        {isHost &&
                          streamerNicks.length < streamMaxStreamers && (
                            <button
                              type="button"
                              onClick={() => clientRef.current?.promote(v.nick)}
                              className="text-xs text-discord-blue hover:underline"
                              title="Invite to stream"
                            >
                              + Invite
                            </button>
                          )}
                      </span>
                    ))}
                  </div>
                )}
                {isStreamer && !isHost && (
                  <button
                    type="button"
                    onClick={() => clientRef.current?.demote()}
                    className="mt-3 text-xs text-discord-red hover:underline"
                  >
                    Step off stream (back to viewer)
                  </button>
                )}
                {isHost && streamerNicks.length > 1 && (
                  <p className="mt-3 text-xs text-discord-text-muted">
                    As host you can also click a streamer's tile to demote them.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="text-discord-red text-xs mt-2">{error}</p>}
      </main>

      <footer className="border-t border-discord-dark-300 p-3 flex items-center justify-center flex-wrap gap-2">
        <div className="flex gap-1 mr-2">
          {["👍", "👏", "❤️", "😂", "🎉", "🔥"].map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => clientRef.current?.sendReaction(e)}
              title="React"
              className="w-9 h-9 rounded-full bg-discord-dark-300 hover:bg-discord-dark-400 text-lg leading-none flex items-center justify-center"
            >
              {e}
            </button>
          ))}
        </div>
        {/* Publishing controls (mic / video / screen / PTT) only show
            for streamers. Viewers in $-channels keep deafen + hand +
            leave so they can still control their listening + signal. */}
        {isStreamer && (
          <>
            <ControlButton
              on={micOn}
              onClick={onToggleMic}
              IconOn={FaMicrophone}
              IconOff={FaMicrophoneSlash}
              label={micOn ? "Mute" : "Unmute"}
            />
            <ControlButton
              on={videoOn}
              onClick={onToggleVideo}
              IconOn={FaVideo}
              IconOff={FaVideoSlash}
              label={videoOn ? "Stop video" : "Start video"}
            />
            <ControlButton
              on={screenOn}
              onClick={onToggleScreen}
              IconOn={FaDesktop}
              IconOff={FaDesktop}
              label={screenOn ? "Stop sharing" : "Share screen"}
            />
          </>
        )}
        <ControlButton
          on={!deafened}
          onClick={onToggleDeafen}
          IconOn={FaVolumeUp}
          IconOff={FaVolumeMute}
          label={deafened ? "Undeafen" : "Deafen"}
        />
        <ControlButton
          on={!handRaised}
          onClick={onToggleHand}
          IconOn={FaHandPaper}
          IconOff={FaHandPaper}
          label={handRaised ? "Lower hand" : "Raise hand"}
          activeOverride={handRaised ? "ring-2 ring-yellow-400" : undefined}
        />
        {isStreamer && (
          <button
            type="button"
            onClick={onTogglePtt}
            title={
              pttMode
                ? "Push-to-talk: hold Space to talk. Click to disable."
                : "Enable push-to-talk (hold Space to talk)"
            }
            className={`px-3 h-12 rounded-full text-xs font-medium transition-colors ${
              pttMode
                ? "bg-discord-blue text-white"
                : "bg-discord-dark-300 text-white hover:bg-discord-dark-400"
            }`}
          >
            PTT
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="ml-4 px-4 py-2 rounded-full bg-discord-red text-white flex items-center gap-2 hover:opacity-90"
          title="Leave voice"
        >
          <FaPhoneSlash />
          Leave
        </button>
      </footer>

      {/* Inbound audio is rendered via a hidden <audio> owned by
          voice.ts so it survives this component unmounting (e.g. when
          the user navigates to a text channel without hanging up). */}
    </div>
  );
};

function ControlButton({
  on,
  onClick,
  IconOn,
  IconOff,
  label,
  activeOverride,
}: {
  on: boolean;
  onClick: () => void;
  IconOn: React.ComponentType;
  IconOff: React.ComponentType;
  label: string;
  activeOverride?: string;
}) {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
        on
          ? "bg-discord-dark-300 text-white hover:bg-discord-dark-400"
          : "bg-discord-red text-white hover:opacity-90"
      } ${activeOverride ?? ""}`}
    >
      <Icon />
    </button>
  );
}

function ParticipantTile({
  member,
  isSelf,
  selfMicOn,
  onClick,
  onSetMuted,
  onSetVolume,
  reactions,
  large,
}: {
  member: VoiceMember;
  isSelf: boolean;
  selfMicOn: boolean;
  onClick: () => void;
  onSetMuted: (nick: string, muted: boolean) => void;
  onSetVolume: (nick: string, volume: number) => void;
  reactions: Array<{ id: number; emoji: string }>;
  large?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current) return;
    if (member.videoTrack) {
      const stream = new MediaStream([member.videoTrack]);
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.srcObject = null;
    }
  }, [member.videoTrack]);

  const showSpeakingRing = member.speaking && (isSelf ? selfMicOn : true);
  const muted = member.volume === 0;
  const aspect = large ? "" : "aspect-video";

  const onMuteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelf) return;
    onSetMuted(member.nick, !muted);
  };

  return (
    <div
      className={`relative bg-discord-dark-300 rounded-lg ${aspect} ${large ? "w-full h-full" : ""} overflow-hidden ${
        showSpeakingRing
          ? "ring-2 ring-discord-green"
          : "ring-1 ring-discord-dark-200"
      }`}
    >
      {/* The tile face is the click target; the volume/mute controls below sit
          above it as siblings so they are not interactive descendants of a button. */}
      <button
        type="button"
        onClick={onClick}
        aria-label={member.nick}
        className="absolute inset-0 flex items-center justify-center cursor-pointer"
      >
        {member.videoTrack ? (
          <video
            ref={videoRef}
            className={`w-full h-full ${member.screenSharing ? "object-contain" : "object-cover"}`}
            autoPlay
            playsInline
            muted={isSelf}
          />
        ) : (
          <div
            className={`${large ? "w-32 h-32 text-5xl" : "w-16 h-16 text-2xl"} rounded-full bg-discord-dark-100 flex items-center justify-center text-white font-bold`}
          >
            {member.nick[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </button>

      {/* Hand-raised badge */}
      {member.handRaised && (
        <div className="pointer-events-none absolute top-1 left-1 px-1.5 py-1 rounded bg-yellow-500/90 text-white text-xs flex items-center gap-1">
          <FaHandPaper />
        </div>
      )}

      {/* Floating emoji reactions */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {reactions.map((r, i) => (
          <span
            key={r.id}
            className="absolute text-3xl animate-react-float"
            style={{
              left: `${30 + ((i * 17) % 40)}%`,
              bottom: "20%",
            }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {/* Connection quality dot */}
      {member.quality !== "unknown" && !isSelf && (
        <div
          className="pointer-events-none absolute top-1 right-1"
          title={`Connection: ${member.quality}`}
        >
          <FaCircle
            className={
              member.quality === "good"
                ? "text-discord-green"
                : member.quality === "ok"
                  ? "text-yellow-400"
                  : "text-discord-red"
            }
            style={{ fontSize: 8 }}
          />
        </div>
      )}

      <div className="absolute bottom-1 left-1 right-1 z-10 px-2 py-0.5 rounded bg-black/50 text-white text-xs flex items-center gap-1.5">
        <span className="truncate flex-1">{member.nick}</span>
        {!member.micOn && !isSelf && (
          <FaMicrophoneSlash className="text-discord-red flex-shrink-0" />
        )}
        {isSelf && !selfMicOn && (
          <FaMicrophoneSlash className="text-discord-red flex-shrink-0" />
        )}
        {member.deafened && (
          <FaVolumeMute className="text-discord-red flex-shrink-0" />
        )}
        {!isSelf && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={member.volume}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetVolume(member.nick, Number(e.target.value))}
            className="w-20 h-1 accent-discord-primary flex-shrink-0 cursor-pointer"
            title={`Volume: ${Math.round(member.volume * 100)}%`}
            aria-label={`Volume for ${member.nick}`}
          />
        )}
        {!isSelf && (
          <button
            type="button"
            onClick={onMuteClick}
            className="text-discord-text-muted hover:text-white flex-shrink-0"
            title={muted ? "Unmute (local)" : "Mute for me only"}
          >
            {muted ? <FaVolumeMute /> : <FaVolumeUp />}
          </button>
        )}
      </div>
    </div>
  );
}

export default VoiceChannelView;
