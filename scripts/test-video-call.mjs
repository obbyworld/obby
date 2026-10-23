#!/usr/bin/env node
// Local test peer for `^` voice and `$` stream channels. Joins a room as
// a second participant so a developer can exercise a video call from a
// single machine: it publishes an animated test pattern so the room
// visibly has "someone" in it, and once it receives video from the real
// participant it echoes that video back a few seconds later so latency
// and quality are visible without a second device.
//
// Speaks the same +obsidianirc/rtc TAGMSG signaling as src/lib/voice.ts
// (the browser client) -- see that file for the protocol writeup this
// mirrors.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArgsError, buildWsUrl, parseArgs, USAGE } from "./lib/cliArgs.mjs";
import { parseIrcLine, prefixNick } from "./lib/ircLine.mjs";
import {
  ChunkReassembler,
  RTC_TAG,
  chunkSignal,
  encodeTagPrefix,
} from "./lib/voiceSignaling.mjs";

const REQUIRED_CAPS = ["message-tags", "obsidianirc/voice"];
const VERBOSE = process.env.VOICE_BOT_VERBOSE === "1";
const REVERT_TO_TEST_PATTERN_AFTER_MS = 5000;
const TEST_PATTERN_DURATION_S = 10;

function checkFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"]);
  if (result.error?.code === "ENOENT") {
    console.error(
      "ffmpeg not found on PATH.\n" +
        "Install it first -- e.g. `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Debian/Ubuntu).\n" +
        "It generates the animated test-pattern video this tool publishes.",
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `ffmpeg -version failed:\n${result.stderr?.toString() ?? result.error?.message ?? ""}`,
    );
    process.exit(1);
  }
}

async function loadWerift() {
  try {
    const core = await import("werift");
    const nonstandard = await import("werift/nonstandard");
    return { ...core, ...nonstandard };
  } catch (err) {
    console.error(
      `werift is not installed or failed to load. Run \`npm install\` first.\n${err.message}`,
    );
    process.exit(1);
  }
}

function generateTestPattern(dir) {
  const file = join(dir, "test-pattern.webm");
  console.log("generating animated test-pattern video with ffmpeg...");
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=640x480:rate=30:duration=${TEST_PATTERN_DURATION_S}`,
      "-an",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libvpx",
      "-deadline",
      "realtime",
      "-cpu-used",
      "4",
      "-b:v",
      "800k",
      "-g",
      "30",
      file,
    ]);
    let stderr = "";
    ff.stderr.on("data", (d) => {
      stderr += d;
    });
    ff.on("error", reject);
    ff.on("exit", (code) => {
      if (code === 0) resolve(file);
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
    });
  });
}

// The join reply carries TURN credentials, and verbose tracing would
// otherwise put a working password in the terminal and any log file.
function redactSecrets(line) {
  return line.replace(/("password"\s*:\s*)"[^"]*"/g, '$1"<redacted>"');
}

class IrcConn {
  constructor(url) {
    this.onClosed = undefined;
    this.url = url;
    this.ws = null;
    this.lineHandlers = [];
  }

  onLine(cb) {
    this.lineHandlers.push(cb);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`could not connect to ${this.url}`)), {
        once: true,
      });
      ws.addEventListener("close", (e) => {
        console.log(
          `connection closed (code ${e.code}${e.reason ? `, ${e.reason}` : ""})`,
        );
        const code = e.code === 1000 ? 0 : 1;
        Promise.resolve(this.onClosed?.()).finally(() => process.exit(code));
      });
      ws.addEventListener("message", (e) => {
        // A websocket frame is already one whole IRC message, and this server
        // sends it without the CRLF a TCP stream would carry, so the frame is
        // the delimiter and waiting for a newline waits forever.
        const text =
          typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
        for (const raw of text.split(/\r?\n/)) {
          if (raw.length === 0) continue;
          if (VERBOSE) console.log("<--", redactSecrets(raw));
          const msg = parseIrcLine(raw);
          for (const h of this.lineHandlers) h(msg, raw);
        }
      });
    });
  }

  send(line) {
    if (VERBOSE) console.log("-->", line);
    // IRC frames terminate on CRLF, so a line without it is never parsed and
    // the server just waits, which looks exactly like a hung registration.
    this.ws.send(`${line}\r\n`);
  }

  close() {
    try {
      this.ws?.close(1000);
    } catch {
      // already closed
    }
  }
}

// Registers (CAP negotiation + NICK/USER), joins the room, and resolves
// once our own JOIN echoes back (or after a 2s fallback, mirroring
// voice.ts's join-echo wait -- see that file for why).
function registerAndJoin(conn, nick, room, delayMs) {
  return new Promise((resolve, reject) => {
    const lsCaps = new Set();
    let lsDone = false;
    let capEnded = false;
    let welcomed = false;
    let signaledJoin = false;
    let selfNick = nick;
    let joinEchoTimer;

    const endCapNegotiation = () => {
      if (lsDone) return;
      lsDone = true;
      const missing = REQUIRED_CAPS.filter((c) => !lsCaps.has(c.toLowerCase()));
      if (missing.length > 0) {
        reject(
          new Error(
            `server does not advertise required capabilities: ${missing.join(", ")}`,
          ),
        );
        return;
      }
      conn.send(`CAP REQ :${REQUIRED_CAPS.join(" ")}`);
    };

    const finishJoin = () => {
      if (signaledJoin) return;
      signaledJoin = true;
      clearTimeout(joinEchoTimer);
      resolve({ selfNick });
    };

    conn.onLine((msg) => {
      if (msg.command === "PING") {
        conn.send(`PONG :${msg.params[0] ?? ""}`);
        return;
      }
      if (msg.command === "ERROR") {
        reject(new Error(`server closed the connection: ${msg.params[0] ?? ""}`));
        return;
      }
      if (msg.command === "CAP") {
        const sub = msg.params[1];
        if (sub === "LS") {
          const multiline = msg.params[2] === "*";
          const list = (multiline ? msg.params[3] : msg.params[2]) ?? "";
          for (const tok of list.split(" ").filter(Boolean)) {
            lsCaps.add(tok.split("=")[0].toLowerCase());
          }
          if (!multiline) endCapNegotiation();
        } else if (sub === "NAK") {
          reject(new Error(`server rejected capability request: ${msg.params[2] ?? ""}`));
        } else if (sub === "ACK" && !capEnded) {
          capEnded = true;
          conn.send("CAP END");
        }
        return;
      }
      if (msg.command === "433" && !welcomed) {
        selfNick = `echo-${randomBytes(3).toString("hex")}`;
        conn.send(`NICK ${selfNick}`);
        return;
      }
      if (msg.command === "001") {
        welcomed = true;
        selfNick = msg.params[0] || selfNick;
        console.log(`registered as ${selfNick}`);
        conn.send(`JOIN ${room}`);
        joinEchoTimer = setTimeout(finishJoin, 2000);
        return;
      }
      if (msg.command === "JOIN" && welcomed && !signaledJoin) {
        const who = prefixNick(msg.prefix).toLowerCase();
        const chan = msg.params[0] ?? "";
        if (who === selfNick.toLowerCase() && chan.toLowerCase() === room.toLowerCase()) {
          console.log(`joined ${room}`);
          console.log(`talk and you will hear yourself back after ~${
            Math.round(delayMs / 1000)
          }s`);
          finishJoin();
        }
      }
    });

    conn.send("CAP LS 302");
    conn.send(`NICK ${nick}`);
    conn.send(`USER ${nick} 0 * :${nick}`);

    setTimeout(() => {
      if (!welcomed) reject(new Error("timed out waiting for server registration"));
    }, 15000);
  });
}

async function runSession({ conn, selfNick, room, delayMs, testPatternFile, werift }) {
  const {
    RTCPeerConnection,
    MediaStreamTrack,
    useVP8,
    useH264,
    useOPUS,
    getUserMedia,
  } = werift;

  const sendSignal = (env) => {
    for (const chunk of chunkSignal(env)) {
      conn.send(`${encodeTagPrefix(chunk)} TAGMSG ${room}`);
    }
  };

  const reassembler = new ChunkReassembler();
  const trackOwners = {};
  const midOwners = {};
  let pendingIce = [];
  let pc;
  let role = "streamer";
  let mode = "voice";

  // Delayed echo source. Everyone in a room publishes Opus, so we relay
  // audio RTP untouched. We leave video alone: clients here publish a mix
  // of VP8 and H264, and relayed bytes are garbage under a payload type
  // that disagrees with them.
  const echoTrack = new MediaStreamTrack({ kind: "audio" });
  let audioSender;
  let testPatternPlayer;
  let testPatternStarted = false;
  let usingEcho = false;
  let lastEchoWriteAt = 0;

  // Relayed packets keep the sender's own numbering, which does not follow
  // on from ours, so a receiver treats the jump as loss and stops playing
  // after the first burst. Restamp every packet onto one continuous stream.
  let echoSeq = Math.floor(Math.random() * 0xffff);
  let echoTs = Math.floor(Math.random() * 0xffffffff);
  let lastPeerTs = null;
  const relayToEcho = (rtp) => {
    const peerTs = rtp.header.timestamp;
    if (lastPeerTs !== null) {
      const delta = (peerTs - lastPeerTs) >>> 0;
      // Keep the sender's own spacing: collapsing a silence would put the
      // audio clock behind real time, and the receiver stretches playback to
      // absorb that. Only an implausible jump gets treated as a restart.
      echoTs = (echoTs + (delta > 48000 * 30 ? 960 : delta)) >>> 0;
    }
    lastPeerTs = peerTs;
    echoSeq = (echoSeq + 1) & 0xffff;
    rtp.header.sequenceNumber = echoSeq;
    rtp.header.timestamp = echoTs;
    echoTrack.writeRtp(rtp);
    lastEchoWriteAt = Date.now();
  };

  async function preparePublishing() {
    testPatternPlayer = await getUserMedia({ path: testPatternFile, loop: true });
    if (!testPatternPlayer.video) {
      throw new Error("test-pattern file produced no video track");
    }
    testPatternStarted = false;
    pc.addTrack(testPatternPlayer.video);
    // One audio sender for the whole session, fed only by the echo. Swapping
    // sources mid-call restarts the numbering and the far end stops playing.
    audioSender = pc.addTrack(echoTrack);
  }

  async function startPublishersOnceNegotiated() {
    if (!testPatternPlayer || testPatternStarted) return;
    testPatternStarted = true;
    await testPatternPlayer.start();
    console.log("publishing the animated test-pattern video");
    sendSignal({ type: "video", state: "on" });
    sendSignal({ type: "mic", state: "on" });
  }

  function attachInboundTrack(track, mid) {
    const nick = (mid && midOwners[mid]) || trackOwners[track.id] || null;
    if (nick && selfNick && nick.toLowerCase() === selfNick.toLowerCase()) return;
    if (track.kind !== "audio") {
      console.log(`receiving video from ${nick ?? "a member"} (not echoed)`);
      return;
    }
    console.log(
      `receiving audio from ${nick ?? "a member"}; echoing it back after ~${delayMs}ms`,
    );
    track.onReceiveRtp.subscribe((rtp) => {
      setTimeout(() => {
        if (!usingEcho) {
          usingEcho = true;
          console.log(`now echoing ${nick ?? "peer"} back`);
        }
        relayToEcho(rtp);
      }, delayMs);
    });
  }

  async function drainPendingIce() {
    if (!pc || pendingIce.length === 0) return;
    const queue = pendingIce;
    pendingIce = [];
    for (const c of queue) {
      try {
        await pc.addIceCandidate(c);
      } catch (err) {
        console.warn(`drained ICE candidate failed: ${err.message}`);
      }
    }
  }

  const isSelf = (member) =>
    !!member && !!selfNick && member.toLowerCase() === selfNick.toLowerCase();

  // Mirroring runs on the audio echo's delay so the round trip reads as
  // one gesture coming back.
  const mirror = (env, describe) => {
    setTimeout(() => {
      sendSignal(env);
      console.log(describe);
    }, delayMs);
  };

  function logPresence(env) {
    if (!env.member) return;
    if (env.state === "joined") {
      console.log(`${env.member} joined the room`);
      // Presence is only broadcast when it changes, so anyone arriving after
      // us starts with the defaults and would show this bot as muted forever.
      if (!isSelf(env.member) && testPatternStarted) {
        sendSignal({ type: "mic", state: "on" });
        sendSignal({ type: "video", state: "on" });
      }
    }
    else if (env.state === "left") console.log(`${env.member} left the room`);
    else if (env.state === "on" || env.state === "off") {
      console.log(`${env.member}: ${env.kind} ${env.state}`);
      if (env.kind === "hand" && !isSelf(env.member)) {
        mirror(
          { type: "hand", state: env.state },
          `mirrored ${env.member}'s hand ${env.state}`,
        );
      }
    }
  }

  async function onJoined(env) {
    mode = env.mode ?? "voice";
    role = env.role ?? "streamer";
    console.log(
      `joined as ${role} in a ${mode === "stream" ? "stream ($)" : "voice (^)"} room`,
    );
    console.log(`members present: ${(env.members ?? []).join(", ") || "(none)"}`);

    const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (env.turn) {
      iceServers.push({
        urls: env.turn.urls,
        username: env.turn.username,
        credential: env.turn.password,
      });
    }
    // VP8 first so our own test pattern publishes as VP8, with H264 also
    // offered because clients here publish either one and the SFU cannot
    // hand us a track whose codec we left out of the m-line.
    pc = new RTCPeerConnection({
      iceServers,
      codecs: { video: [useVP8(), useH264()], audio: [useOPUS()] },
    });
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      sendSignal({
        type: "ice",
        cand: e.candidate.candidate,
        mid: e.candidate.sdpMid ?? undefined,
        mlineidx: e.candidate.sdpMLineIndex ?? undefined,
      });
    };
    pc.ontrack = (e) => attachInboundTrack(e.track, e.transceiver?.mid);
    pc.connectionStateChange.subscribe((state) => console.log(`peer connection: ${state}`));

    // A recvonly audio transceiver gives the offer its audio m-line and
    // lets us report who has their mic on.
    pc.addTransceiver("audio", { direction: "recvonly" });

    if (role === "streamer") {
      await preparePublishing();
    } else {
      console.log(
        "joined as a VIEWER: this stream room needs promotion before this bot can publish. " +
          "Receiving only until then.",
      );
      pc.addTransceiver("video", { direction: "recvonly" });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: "offer", sdp: offer.sdp ?? "" });
  }

  async function onRoleChange(member, newRole) {
    console.log(`role change: ${member} -> ${newRole}`);
    if (!selfNick || member.toLowerCase() !== selfNick.toLowerCase()) return;
    if (newRole === "streamer" && role !== "streamer") {
      role = newRole;
      console.log("promoted to streamer: publishing the test pattern now");
      await preparePublishing();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: "offer", sdp: offer.sdp ?? "" });
    } else if (newRole === "viewer") {
      role = newRole;
    }
  }

  async function handleSignal(env) {
    if (env.tracks) {
      for (const h of env.tracks) {
        trackOwners[h.track_id] = h.member;
        if (h.mid) midOwners[h.mid] = h.member;
      }
    }
    switch (env.type) {
      case "joined":
        await onJoined(env);
        break;
      case "answer":
        if (env.sdp && pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: env.sdp });
          await drainPendingIce();
          await startPublishersOnceNegotiated();
        }
        break;
      case "offer":
        if (env.sdp && pc) {
          await pc.setRemoteDescription({ type: "offer", sdp: env.sdp });
          await drainPendingIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "answer", sdp: answer.sdp ?? "" });
        }
        break;
      case "ice":
        if (env.cand && pc) {
          const cand = {
            candidate: env.cand,
            sdpMid: env.mid ?? null,
            sdpMLineIndex: env.mlineidx ?? null,
          };
          if (!pc.remoteDescription) pendingIce.push(cand);
          else await pc.addIceCandidate(cand).catch((err) => console.warn(`addIceCandidate failed: ${err.message}`));
        }
        break;
      case "presence":
        logPresence(env);
        break;
      case "hand":
        if (env.member && !isSelf(env.member)) {
          mirror(
            { type: "hand", state: env.state },
            `mirrored ${env.member}'s hand ${env.state}`,
          );
        }
        break;
      case "react":
        // The server echoes a reaction back to whoever sent it, so without
        // the self check the bot would answer its own mirror forever.
        if (env.emoji && env.member && !isSelf(env.member)) {
          console.log(`${env.member} reacted ${env.emoji}`);
          mirror(
            { type: "react", emoji: env.emoji },
            `mirrored ${env.member}'s ${env.emoji}`,
          );
        }
        break;
      case "role":
        if (env.member && env.role) await onRoleChange(env.member, env.role);
        break;
      case "error":
        console.error(`server error: ${env.error}`);
        if (!pc) process.exit(1);
        break;
    }
  }

  conn.onLine((msg) => {
    if (msg.command !== "TAGMSG") return;
    const raw = msg.tags[RTC_TAG];
    if (!raw) return;
    let env;
    try {
      env = JSON.parse(raw);
    } catch (err) {
      console.warn(`received malformed RTC payload: ${err.message}`);
      return;
    }
    const complete = reassembler.push(env);
    if (!complete) return;
    void handleSignal(complete);
  });

  sendSignal({ type: "join", channel: room });

  return {
    leave: () => {
      sendSignal({ type: "leave", channel: room });
      pc?.close();
    },
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ArgsError) {
      if (err.message === USAGE) {
        console.log(USAGE);
        process.exit(0);
      }
      console.error(`${err.message}\n\n${USAGE}`);
      process.exit(1);
    }
    throw err;
  }

  checkFfmpeg();
  const werift = await loadWerift();

  const tmpDir = await mkdtemp(join(tmpdir(), "obby-test-video-"));
  const cleanupTmp = () => rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  let session;
  let conn;
  const cleanup = async () => {
    console.log("\nleaving...");
    try {
      session?.leave();
      conn?.send(`PART ${args.room}`);
    } catch {
      // best effort
    }
    conn?.close();
    await cleanupTmp();
  };
  process.on("SIGINT", () => cleanup().finally(() => process.exit(0)));
  process.on("SIGTERM", () => cleanup().finally(() => process.exit(0)));

  try {
    const testPatternFile = await generateTestPattern(tmpDir);

    const url = buildWsUrl(args.host, args.port);
    console.log(`connecting to ${url}...`);
    conn = new IrcConn(url);
    conn.onClosed = cleanupTmp;
    await conn.connect();
    console.log("connected");

    const nick = `talk-to-hear-echo-${randomBytes(2).toString("hex")}`;
    const { selfNick } = await registerAndJoin(conn, nick, args.room, args.delayMs);

    session = await runSession({
      conn,
      selfNick,
      room: args.room,
      delayMs: args.delayMs,
      testPatternFile,
      werift,
    });
  } catch (err) {
    console.error(`fatal: ${err.message ?? err}`);
    await cleanupTmp();
    process.exit(1);
  }
}

main();
