// Obby-native private-message E2EE — a modern Double Ratchet carried in IRCv3
// client-only tags so it stays invisible to non-supporting clients and is
// never logged as message content. All payloads are base64 (RFC 4648 §4) of
// compact JSON; the base64 alphabet never collides with IRCv3 tag-value
// escaping, so no escape pass is needed on the wire (same convention as
// draft/bot-tools). The crypto itself lives in a pluggable backend; this file
// only owns the wire format so it can be unit-tested without any crypto deps.

import { base64DecodeUtf8, base64EncodeUtf8 } from "../base64";

export const E2EE_CAP = "obby.world/e2ee";

// Handshake/control frames (init, accept, reject, ack) ride in this client-only
// TAGMSG tag: invisible to non-Obby clients and needing no msgid, since nothing
// threads onto a handshake. Relies on the server relaying the tag.
export const E2EE_TAG = "+obby.world/e2ee";

// Message payloads ride in the PRIVMSG body behind this marker (like OTR's
// `?OTR:`), so the IRC envelope — msgid, reply-to, reactions, redaction,
// CHATHISTORY — stays real and only the payload is opaque. Needs no server
// cooperation. For both transports the kind lives in the JSON `t` field, and
// base64 never collides with the marker, so body detection is a prefix test.
export const E2EE_BODY_PREFIX = "?obe2ee:";

export type E2EEKind = "init" | "accept" | "reject" | "msg" | "frag";

export const PROTOCOL_VERSION = 2;

// A client tag caps near 4094 bytes (message-tags spec); a PRIVMSG body is far
// tighter (a ~512-byte line). Payloads over the per-transport cap split into
// `frag` frames, each sliced to stay under the cap once wrapped in its own
// base64+JSON envelope.
export const MAX_TAG_VALUE_BYTES = 3500;
export const MAX_TAG_FRAGMENT_SLICE = 2800;
export const MAX_BODY_VALUE_BYTES = 400;
export const MAX_BODY_FRAGMENT_SLICE = 220;

// Handshake offer. `bundle` is the initiator's opaque X3DH pre-key bundle
// (serialized by the crypto layer — this module stays crypto-agnostic so the
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

// `pre` flags a session-establishing ciphertext (an Olm pre-key message) so the
// receiving backend knows to create the session rather than decrypt on an
// existing one.
export interface E2EECipher {
  t: "msg";
  v: typeof PROTOCOL_VERSION;
  ct: string;
  pre?: boolean;
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
  | E2EECipher
  | E2EEFragment;

export function encodeE2EEPayload(payload: E2EEPayload): string {
  return base64EncodeUtf8(JSON.stringify(payload));
}

// Wrap a payload for the PRIVMSG body; `bodyToRaw` reverses it, returning null
// for any body that isn't Obby traffic so the normal message path keeps it.
export function frameToBody(payload: E2EEPayload): string {
  return `${E2EE_BODY_PREFIX}${encodeE2EEPayload(payload)}`;
}

export function bodyToRaw(body: string): string | null {
  return body.startsWith(E2EE_BODY_PREFIX)
    ? body.slice(E2EE_BODY_PREFIX.length)
    : null;
}

// Decode a raw tag value into a structured payload, returning null on any
// decode/parse failure or schema mismatch rather than throwing — payloads are
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
    case "msg": {
      if (typeof o.ct !== "string") return null;
      const m: E2EECipher = { t: "msg", v: PROTOCOL_VERSION, ct: o.ct };
      if (typeof o.pre === "boolean") m.pre = o.pre;
      return m;
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
  sliceSize: number = MAX_BODY_FRAGMENT_SLICE,
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
// fragment is missing or the set is inconsistent — mismatched totals, indices
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
