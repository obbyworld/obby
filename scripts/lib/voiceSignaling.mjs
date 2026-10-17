// Wire format for the +obsidianirc/rtc TAGMSG envelope, ported from
// src/lib/voice.ts (the browser client). Kept as plain, dependency-free
// functions so both the browser client's rules and this Node test peer
// stay provably identical without either side importing the other's
// browser- or Node-only runtime.

export const RTC_TAG = "+obsidianirc/rtc";

// Matches voice.ts's VoiceClient.WIRE_BUDGET: headroom under the ircd's
// 8192-byte MAXTAGSIZE for the ` TAGMSG <channel>\r\n` suffix and slop.
export const WIRE_BUDGET = 7800;

// Mirrors UnrealIRCd's message_tag_escape byte-for-byte (see voice.ts).
export function escapeIrcTagValue(s) {
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

// Reverses escapeIrcTagValue. An unrecognized escape sequence drops the
// backslash and keeps the following character literally, per IRCv3.
export function unescapeIrcTagValue(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\" || i === s.length - 1) {
      out += s[i];
      continue;
    }
    const next = s[i + 1];
    i++;
    switch (next) {
      case ":":
        out += ";";
        break;
      case "s":
        out += " ";
        break;
      case "\\":
        out += "\\";
        break;
      case "r":
        out += "\r";
        break;
      case "n":
        out += "\n";
        break;
      default:
        out += next;
    }
  }
  return out;
}

// Matches voice.ts's encodedTagCost: on-wire byte cost of one raw SDP
// character after JSON.stringify + escapeIrcTagValue.
export function encodedTagCost(charCode) {
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

// Predicted wire size of `@<tag>=<value>` for an envelope, matching
// voice.ts's wireSize().
export function wireSize(env) {
  return RTC_TAG.length + 2 + escapeIrcTagValue(JSON.stringify(env)).length;
}

export function randomChunkId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Splits an offer/answer envelope whose SDP would exceed WIRE_BUDGET into
// chunks sharing an id with sequential seq/total, matching voice.ts's
// sendChunkedSignal. Envelopes that fit (or aren't offer/answer) pass
// through as a single-element array.
export function chunkSignal(env) {
  if (
    (env.type === "offer" || env.type === "answer") &&
    env.sdp &&
    wireSize(env) > WIRE_BUDGET
  ) {
    return sliceSdpChunks(env);
  }
  return [env];
}

function sliceSdpChunks(env) {
  const sdp = env.sdp ?? "";
  const id = randomChunkId();

  const overhead = wireSize({ ...env, sdp: "", id, seq: 999, total: 999 });
  const sliceBudget = WIRE_BUDGET - overhead;

  const slices = [];
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
  return slices.map((slice, seq) => ({ ...env, sdp: slice, id, seq, total }));
}

// Renders one (possibly chunked) envelope as the `@tag=value` prefix for
// a raw IRC line.
export function encodeTagPrefix(env) {
  return `@${RTC_TAG}=${escapeIrcTagValue(JSON.stringify(env))}`;
}

// Reassembles chunked offer/answer envelopes pushed by the server, one
// instance per connection. Mirrors voice.ts's inboundChunks buffering.
export class ChunkReassembler {
  constructor() {
    this.pending = new Map();
  }

  // Feed one decoded envelope. Returns the complete envelope once every
  // chunk has arrived, or null while still buffering.
  push(env) {
    if (!(env.id && env.total !== undefined && env.seq !== undefined && env.total > 1)) {
      return env;
    }
    let slot = this.pending.get(env.id);
    if (!slot) {
      slot = {
        base: { ...env, sdp: undefined },
        parts: new Array(env.total),
        filled: 0,
        total: env.total,
      };
      this.pending.set(env.id, slot);
    }
    if (slot.parts[env.seq] === undefined) {
      slot.parts[env.seq] = env.sdp ?? "";
      slot.filled++;
    }
    if (env.tracks && (!slot.base.tracks || slot.base.tracks.length === 0)) {
      slot.base.tracks = env.tracks;
    }
    if (slot.filled < slot.total) return null;
    this.pending.delete(env.id);
    return { ...slot.base, sdp: slot.parts.join("") };
  }
}
