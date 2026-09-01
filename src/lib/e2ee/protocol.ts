// Obby-native private-message E2EE: a modern Double Ratchet carried in IRCv3
// client-only tags so it stays invisible to non-supporting clients and is
// never logged as message content. All payloads are base64 (RFC 4648 §4) of
// compact JSON; the base64 alphabet never collides with IRCv3 tag-value
// escaping, so no escape pass is needed on the wire (same convention as
// draft/bot-tools). The crypto itself lives in a pluggable backend; this file
// only owns the wire format so it can be unit-tested without any crypto deps.

import { base64DecodeUtf8, base64EncodeUtf8 } from "../base64";

export const E2EE_CAP = "obby.world/e2ee";

// Every payload rides this tag. A control frame rides a bodiless TAGMSG; a
// message rides a PRIVMSG, whose body is the marker below, so it keeps a real
// msgid for reply, react and redaction. A relay may drop a client tag with an
// empty value, so the value is always set.
export const E2EE_TAG = "+obby.world/e2ee";

// The whole body of a message carrier. It says what the row is to anything that
// cannot read the tag, and it is what identifies a replay that arrives with its
// client tags stripped (a bouncer serving its own buffer).
export const E2EE_BODY_MARKER = "?obe2ee:";

// Carried on every frame so a peer speaking a version this client cannot read
// is told so, instead of the mismatch surfacing as a decrypt failure.
export const PROTOCOL_VERSION = 1;

// obbyircd carries a 2000-byte tag value and drops 3000 outright, so the cap is
// what a relay carries, with room left for the tag name and the reply and label
// tags beside it. Every extra frame spends flood allowance (~15 commands before
// the server paces one per second), so the slice is as large as the cap allows.
export const MAX_TAG_VALUE_BYTES = 1700;

// A slice leaves the wire wrapped in a `frag` envelope and base64ed again, so
// it is derived from the cap rather than guessed alongside it.
const FRAGMENT_ENVELOPE_BYTES = 96;
export const MAX_TAG_FRAGMENT_SLICE =
  Math.floor((MAX_TAG_VALUE_BYTES * 3) / 4) - FRAGMENT_ENVELOPE_BYTES;

// Handshake offer. `bundle` is the initiator's opaque X3DH pre-key bundle
// (serialized by the crypto layer, so this module stays crypto-agnostic and the
// wire format doesn't churn with key-agreement details). `account` is the
// sender's SASL account, the identity anchor; the fingerprint is derived by the
// receiver from the bundle's signing key, never self-asserted on the wire.
export interface E2EEInit {
  t: "init";
  v: typeof PROTOCOL_VERSION;
  bundle: string;
  account?: string;
}

// Handshake response. `response` is the responder's opaque X3DH reply +
// bootstrap ciphertext, which establishes both sides once processed.
export interface E2EEAccept {
  t: "accept";
  v: typeof PROTOCOL_VERSION;
  response: string;
  account?: string;
}

export interface E2EEReject {
  t: "reject";
  v: typeof PROTOCOL_VERSION;
  reason?: string;
}

// Teardown. Sent when a side ends an established session so the peer's lock
// drops too, instead of it encrypting into a conversation that no longer
// decrypts. Rides the same control carrier as the rest of the handshake.
export interface E2EEClose {
  t: "close";
  v: typeof PROTOCOL_VERSION;
}

// The initiator's proof that it can decrypt, which is how the responder learns
// the handshake completed. Carries a ciphertext like `msg` but is never
// rendered.
export interface E2EEAck {
  t: "ack";
  v: typeof PROTOCOL_VERSION;
  ct: string;
}

// An attachment. Encrypted like `msg`, but the plaintext is a descriptor
// (location, file key, type) rather than chat text, so the client renders a
// media row and the file's URL never becomes message content.
export interface E2EEMediaFrame {
  t: "media";
  v: typeof PROTOCOL_VERSION;
  ct: string;
}

export interface E2EECipher {
  t: "msg";
  v: typeof PROTOCOL_VERSION;
  ct: string;
}

export interface E2EEFragment {
  t: "frag";
  v: typeof PROTOCOL_VERSION;
  id: string;
  i: number;
  n: number;
  ct: string;
}

export type E2EEPayload =
  | E2EEInit
  | E2EEAccept
  | E2EEReject
  | E2EEClose
  | E2EEAck
  | E2EECipher
  | E2EEMediaFrame
  | E2EEFragment;

export function encodeE2EEPayload(payload: E2EEPayload): string {
  return base64EncodeUtf8(JSON.stringify(payload));
}

// The protocol version a raw frame claims, for the case where decoding fails
// only because the version differs: the peer can then be told the version is
// unsupported rather than left waiting out a negotiation timeout.
export function readPayloadVersion(raw: string): number | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64DecodeUtf8(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = (parsed as Record<string, unknown>).v;
  return typeof v === "number" ? v : null;
}

// Decode a raw tag value into a structured payload, returning null on any
// decode/parse failure or schema mismatch rather than throwing: payloads are
// attacker-controlled, so malformed input is silently discarded.
export function decodeE2EEPayload(raw: string): E2EEPayload | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64DecodeUtf8(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION) return null;

  switch (o.t) {
    case "init": {
      if (typeof o.bundle !== "string") return null;
      const m: E2EEInit = { t: "init", v: PROTOCOL_VERSION, bundle: o.bundle };
      if (typeof o.account === "string") m.account = o.account;
      return m;
    }
    case "accept": {
      if (typeof o.response !== "string") return null;
      const m: E2EEAccept = {
        t: "accept",
        v: PROTOCOL_VERSION,
        response: o.response,
      };
      if (typeof o.account === "string") m.account = o.account;
      return m;
    }
    case "reject": {
      const m: E2EEReject = { t: "reject", v: PROTOCOL_VERSION };
      if (typeof o.reason === "string") m.reason = o.reason;
      return m;
    }
    case "close":
      return { t: "close", v: PROTOCOL_VERSION };
    case "ack": {
      if (typeof o.ct !== "string") return null;
      return { t: "ack", v: PROTOCOL_VERSION, ct: o.ct };
    }
    case "media": {
      if (typeof o.ct !== "string") return null;
      return { t: "media", v: PROTOCOL_VERSION, ct: o.ct };
    }
    case "msg": {
      if (typeof o.ct !== "string") return null;
      return { t: "msg", v: PROTOCOL_VERSION, ct: o.ct };
    }
    case "frag": {
      if (
        typeof o.id !== "string" ||
        typeof o.ct !== "string" ||
        typeof o.i !== "number" ||
        typeof o.n !== "number" ||
        !Number.isInteger(o.i) ||
        !Number.isInteger(o.n) ||
        o.n <= 0 ||
        o.i < 0 ||
        o.i >= o.n
      )
        return null;
      return {
        t: "frag",
        v: PROTOCOL_VERSION,
        id: o.id,
        i: o.i,
        n: o.n,
        ct: o.ct,
      };
    }
    default:
      return null;
  }
}

// Split a too-long tag value into ordered fragments keyed by `id`. base64 is
// pure ASCII, so slicing by character length equals slicing by byte length.
export function fragmentValue(
  id: string,
  value: string,
  sliceSize: number = MAX_TAG_FRAGMENT_SLICE,
): E2EEFragment[] {
  const slices: string[] = [];
  for (let i = 0; i < value.length; i += sliceSize) {
    slices.push(value.slice(i, i + sliceSize));
  }
  const n = slices.length;
  return slices.map((ct, i) => ({
    t: "frag",
    v: PROTOCOL_VERSION,
    id,
    i,
    n,
    ct,
  }));
}

// Rebuild the original tag value from a complete fragment set, or null if any
// fragment is missing or the set is inconsistent: mismatched totals, indices
// out of range, or fragments from a different `id` (two concurrent streams must
// never be spliced into one value).
export function reassembleFragments(
  frags: readonly E2EEFragment[],
): string | null {
  if (!frags.length) return null;
  const { id, n } = frags[0];
  const parts = new Array<string>(n);
  const seen = new Set<number>();
  for (const f of frags) {
    if (f.id !== id || f.n !== n || f.i < 0 || f.i >= n) return null;
    parts[f.i] = f.ct;
    seen.add(f.i);
  }
  if (seen.size !== n) return null;
  return parts.join("");
}
