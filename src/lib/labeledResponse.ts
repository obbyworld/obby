// labeled-response: tag generator + helper utilities.
//
// Spec: the label tag value is opaque, MUST NOT exceed 64 bytes, and
// SHOULD NOT be reused before a complete response is received.  We
// produce values like `lr-<base36 ms>-<counter>` which are well under
// 64 bytes and monotonically unique within a process.

import ircClient from "./ircClient";

let counter = 0;

export function makeLabel(): string {
  counter = (counter + 1) % 0xffffff;
  return `lr-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Combine an existing IRC tag prefix (which may already include things
 * like `+reply=...`) with a `label=...` tag, preserving the leading `@`
 * and the trailing space the wire format expects.
 *
 * - `existingPrefix` is either "" or "@k1=v1;k2=v2 " (with trailing space).
 * - Returns "" if `label` is null/undefined; otherwise the combined
 *   prefix with one trailing space.
 */
export function withLabel(
  existingPrefix: string,
  label: string | null | undefined,
): string {
  if (!label) return existingPrefix;
  if (!existingPrefix) return `@label=${label} `;
  // existingPrefix already starts with '@' and ends with ' '; insert
  // before the trailing space.
  const trimmed = existingPrefix.endsWith(" ")
    ? existingPrefix.slice(0, -1)
    : existingPrefix;
  return `${trimmed};label=${label} `;
}

// A label only pays off when the server echoes our own send back inside a
// labelled batch; without those caps the placeholder would never be confirmed.
export function shouldUseLabeledResponse(serverId: string): boolean {
  return (
    ircClient.hasCapability(serverId, "labeled-response") &&
    ircClient.hasCapability(serverId, "echo-message") &&
    ircClient.hasCapability(serverId, "batch")
  );
}
