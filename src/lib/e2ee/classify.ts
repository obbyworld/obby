// Routes an inbound message to the encryption scheme that owns it. Both schemes
// now ride in the PRIVMSG body behind a well-known prefix — Obby's `?obe2ee:`
// and OTR's `?OTR…`. Anything else is plaintext and follows the normal message
// path untouched. Cheap, pure, and the single source of truth for "which backend
// gets this".

import { E2EE_BODY_PREFIX } from "./protocol";

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

export function classifyInbound(input: { body?: string }): InboundScheme {
  const { body } = input;
  if (body) {
    if (body.startsWith(E2EE_BODY_PREFIX)) return { scheme: "obby" };
    for (const [prefix, kind] of OTR_PREFIXES) {
      if (body.startsWith(prefix)) return { scheme: "otr", kind };
    }
  }
  return { scheme: "plaintext" };
}
