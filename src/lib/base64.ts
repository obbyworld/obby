// UTF-8-safe base64 with padding (RFC 4648 §4), shared by the draft/bot-cmds
// and draft/bot-tools protocols. btoa/atob operate on Latin-1 only, so we
// round-trip through UTF-8 bytes; the base64 alphabet never collides with
// IRCv3 tag-value escaping, so no escape pass is needed on the wire.

export function base64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64DecodeUtf8(b64: string): string {
  // atob tolerates missing padding; normalise so senders that strip `=` work.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
