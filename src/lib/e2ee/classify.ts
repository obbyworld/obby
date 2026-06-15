// Routes an inbound message to the encryption scheme that owns it. Obby-native
// traffic rides in client-only tags; OTR traffic rides in the PRIVMSG body as
// the well-known `?OTR` prefixes. Anything else is plaintext and follows the
// normal message path untouched. Cheap, pure, and the single source of truth
// for "which backend gets this".

import { E2EE_TAG } from "./protocol";

export type OtrKind = "data" | "query" | "fragment" | "error";

export type InboundScheme =
  | { scheme: "obby"; tag: string }
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
  const { mtags, body } = input;
  if (mtags?.[E2EE_TAG] !== undefined) {
    return { scheme: "obby", tag: E2EE_TAG };
  }
  if (body) {
    for (const [prefix, kind] of OTR_PREFIXES) {
      if (body.startsWith(prefix)) return { scheme: "otr", kind };
    }
  }
  return { scheme: "plaintext" };
}
