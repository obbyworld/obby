// Carries E2EE payloads in the PRIVMSG body behind the Obby marker. A payload
// whose encoded value fits one body is sent as a single frame; an oversized
// value is split into `frag` frames and rebuilt by the receiver. Outbound
// framing is pure; inbound reassembly is a small stateful accumulator that
// sweeps never-completed streams so a hostile or dropped sender can't leak
// memory.

import {
  E2EE_BODY_PREFIX,
  type E2EEFragment,
  type E2EEPayload,
  encodeE2EEPayload,
  fragmentValue,
  frameToBody,
  MAX_BODY_VALUE_BYTES,
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

// Returns the marker-wrapped body frame(s) to put on the wire; the caller wraps
// each in its own PRIVMSG so every frame keeps a real IRC envelope.
export function framePayload(
  payload: E2EEPayload,
  fragmentId: string,
): string[] {
  const value = encodeE2EEPayload(payload);
  if (value.length <= MAX_BODY_VALUE_BYTES) {
    return [`${E2EE_BODY_PREFIX}${value}`];
  }
  return fragmentValue(fragmentId, value).map(frameToBody);
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
