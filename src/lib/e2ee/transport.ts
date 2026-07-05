// Frames E2EE payloads for the wire: control frames as TAGMSG tag values,
// message frames in the PRIVMSG body behind the Obby marker. A payload that fits
// one frame is sent whole; an oversized one is split into `frag` frames and
// rebuilt by the receiver. Outbound framing is pure; inbound reassembly is a
// small stateful accumulator that sweeps never-completed streams so a hostile or
// dropped sender can't leak memory.

import {
  E2EE_BODY_PREFIX,
  type E2EEFragment,
  type E2EEPayload,
  encodeE2EEPayload,
  fragmentValue,
  frameToBody,
  MAX_BODY_FRAGMENT_SLICE,
  MAX_BODY_VALUE_BYTES,
  MAX_TAG_FRAGMENT_SLICE,
  MAX_TAG_VALUE_BYTES,
  reassembleFragments,
} from "./protocol";

// Partial fragment streams older than this are discarded. The wire never needs
// minutes to deliver a few-KB message; a stream still open after this was
// abandoned (netsplit, malicious opener) and must not pin memory.
export const FRAGMENT_TTL_MS = 30_000;

// Hard ceilings so a hostile sender can't pin memory within the TTL window: a
// real PM fragments into a handful of slices, and few conversations reassemble
// at once. Streams beyond these bounds are dropped rather than buffered.
export const MAX_FRAGMENTS_PER_STREAM = 64;
export const MAX_CONCURRENT_STREAMS = 64;

// Message frames: marker-wrapped body string(s); the caller wraps each in its
// own PRIVMSG so every frame keeps a real IRC envelope.
export function framePayload(
  payload: E2EEPayload,
  fragmentId: string,
): string[] {
  const value = encodeE2EEPayload(payload);
  if (value.length <= MAX_BODY_VALUE_BYTES) {
    return [`${E2EE_BODY_PREFIX}${value}`];
  }
  return fragmentValue(fragmentId, value, MAX_BODY_FRAGMENT_SLICE).map(
    frameToBody,
  );
}

// Control frames: the raw base64 tag value(s); the caller wraps each in a
// TAGMSG under the Obby tag. Handshakes carry no msgid and stay invisible to
// non-Obby clients.
export function frameTagPayload(
  payload: E2EEPayload,
  fragmentId: string,
): string[] {
  const value = encodeE2EEPayload(payload);
  if (value.length <= MAX_TAG_VALUE_BYTES) {
    return [value];
  }
  return fragmentValue(fragmentId, value, MAX_TAG_FRAGMENT_SLICE).map(
    encodeE2EEPayload,
  );
}

interface FragmentBuffer {
  frags: E2EEFragment[];
  firstSeen: number;
}

export class FragmentReassembler {
  private buffers = new Map<string, FragmentBuffer>();

  // Accept a fragment; return the rebuilt tag value once its set is complete,
  // else null. The completed value is the base64 of the original payload, which
  // the caller decodes with decodeE2EEPayload.
  add(frag: E2EEFragment, now: number = Date.now()): string | null {
    this.sweep(now);
    if (frag.n > MAX_FRAGMENTS_PER_STREAM) return null;
    const existing = this.buffers.get(frag.id);
    if (!existing && this.buffers.size >= MAX_CONCURRENT_STREAMS) return null;
    const buf = existing ?? { frags: [], firstSeen: now };
    if (buf.frags.length >= MAX_FRAGMENTS_PER_STREAM) {
      this.buffers.delete(frag.id);
      return null;
    }
    buf.frags.push(frag);
    this.buffers.set(frag.id, buf);
    const value = reassembleFragments(buf.frags);
    if (value !== null) {
      this.buffers.delete(frag.id);
      return value;
    }
    return null;
  }

  private sweep(now: number): void {
    for (const [id, buf] of this.buffers) {
      if (now - buf.firstSeen > FRAGMENT_TTL_MS) this.buffers.delete(id);
    }
  }
}
