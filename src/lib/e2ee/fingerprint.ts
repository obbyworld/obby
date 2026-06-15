// Renders identity-key bytes as a human-comparable fingerprint and a two-party
// combined fingerprint for out-of-band verification. The combined form is
// order-independent so both peers, computing it from the same two keys, read
// the identical string regardless of who initiated.

const DEFAULT_GROUP_SIZE = 4;
const DEFAULT_GROUPS = 8;

export function formatFingerprint(
  bytes: Uint8Array,
  groupSize: number = DEFAULT_GROUP_SIZE,
  groups: number = DEFAULT_GROUPS,
): string {
  const hexChars = groupSize * groups;
  const byteCount = Math.min(bytes.length, Math.ceil(hexChars / 2));
  let hex = "";
  for (let i = 0; i < byteCount; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  hex = hex.slice(0, hexChars).toUpperCase();
  const out: string[] = [];
  for (let i = 0; i < hex.length; i += groupSize) {
    out.push(hex.slice(i, i + groupSize));
  }
  return out.join(" ");
}

export function combinedFingerprint(fpA: string, fpB: string): string {
  return [fpA, fpB].sort().join("  ");
}
