// Routes an inbound message to the encryption scheme that owns it. A bodied
// message (PRIVMSG) is classified by its body alone: Obby by its `?obe2ee:`
// marker, OTR by its `?OTR…` prefix, else plaintext. The Obby flag tag is
// deliberately NOT consulted here — it's unreliable on a PRIVMSG (servers may
// strip it, any client may attach it), so the body marker is the authoritative
// ciphertext signal. The tag only classifies a bodiless control TAGMSG, where
// the tag value itself is the payload. Cheap, pure, and the single source of
// truth for "which backend gets this".

import { E2EE_BODY_PREFIX, E2EE_TAG } from "./protocol";

export type OtrKind = "data" | "query" | "fragment" | "error";

export type InboundScheme =
  | { scheme: "obby" }
  | { scheme: "otr"; kind: OtrKind }
  | { scheme: "plaintext" };

// Order matters: the more specific OTR prefixes (data, fragments, error) are
// matched before the broader query forms so a fragment isn't misread as a
// query. `?OTRv…?` and bare `?OTR?` are both version queries.
const OTR_PREFIXES: ReadonlyArray<readonly [string, OtrKind]> = [
  ["?OTR:", "data"],
  ["?OTR|", "fragment"],
  ["?OTR,", "fragment"],
  ["?OTR Error:", "error"],
  ["?OTRv", "query"],
  ["?OTR?", "query"],
];

export function classifyInbound(input: {
  mtags?: Record<string, string>;
  body?: string;
}): InboundScheme {
  if (input.body) {
    if (input.body.startsWith(E2EE_BODY_PREFIX)) return { scheme: "obby" };
    for (const [prefix, kind] of OTR_PREFIXES) {
      if (input.body.startsWith(prefix)) return { scheme: "otr", kind };
    }
    return { scheme: "plaintext" };
  }
  if (input.mtags?.[E2EE_TAG] !== undefined) return { scheme: "obby" };
  return { scheme: "plaintext" };
}
