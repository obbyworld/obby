// Frames an E2EE payload into base64 value(s) for the wire. A payload within
// `maxWhole` is one value; an oversized one splits into `frag` frames sized to
// `sliceSize` and is rebuilt by the receiver. The caller wraps each value in its
// carrier — a control TAGMSG tag value, or a message PRIVMSG body under the flag
// tag. Outbound framing is pure; inbound reassembly is a small stateful
// accumulator that sweeps never-completed streams so a hostile or dropped sender
// can't leak memory.

import {
  type E2EEFragment,
  type E2EEPayload,
  encodeE2EEPayload,
  fragmentValue,
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

export function frameValues(
  payload: E2EEPayload,
  fragmentId: string,
  maxWhole: number,
  sliceSize: number,
): string[] {
  const value = encodeE2EEPayload(payload);
  if (value.length <= maxWhole) return [value];
  return fragmentValue(fragmentId, value, sliceSize).map(encodeE2EEPayload);
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
