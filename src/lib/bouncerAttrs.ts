// soju.im/bouncer-networks encodes per-network attributes as a single
// semicolon-separated token of `key=value` pairs. Values escape with the
// IRCv3 message-tag rules (\: ; \s SPACE \\ \\ \r CR \n LF), keys are plain.
//
// We keep this codec isolated so the IRC handler stays a thin dispatcher
// and the store/UI can serialise their own ADDNETWORK / CHANGENETWORK
// payloads via the same primitives.

export function escapeBouncerValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\:")
    .replace(/ /g, "\\s")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

export function unescapeBouncerValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const c = value[i + 1];
      if (c === "\\") out += "\\";
      else if (c === ":") out += ";";
      else if (c === "s") out += " ";
      else if (c === "r") out += "\r";
      else if (c === "n") out += "\n";
      // Unknown escape: pass through the second char verbatim per the
      // permissive interpretation in the message-tag spec.
      else out += c;
      i++;
    } else {
      out += value[i];
    }
  }
  return out;
}

export function encodeBouncerAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === "" ? k : `${k}=${escapeBouncerValue(v)}`))
    .join(";");
}

// An attribute with no `=` is present-with-no-value (e.g. `state` cleared
// in a notify); we represent that as an empty-string value to keep the
// returned record's shape stable. Per the spec, an attribute appearing
// without a value in a notify means it was removed -- callers handle
// that distinction at the diff layer.
export function decodeBouncerAttrs(token: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!token) return out;
  for (const part of token.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      out[part] = "";
    } else {
      const k = part.slice(0, eq);
      const v = unescapeBouncerValue(part.slice(eq + 1));
      out[k] = v;
    }
  }
  return out;
}

// Whether a given attribute name is read-only per spec. Clients should
// not send these in ADDNETWORK / CHANGENETWORK; servers return a
// READ_ONLY_ATTRIBUTE FAIL if they do.
export const BOUNCER_READ_ONLY_ATTRIBUTES = new Set<string>(["state", "error"]);

// Attributes the spec defines explicitly. Anything else is implementation
// defined (still valid wire data, but our UI hides them unless told to
// surface them).
export const BOUNCER_STANDARD_ATTRIBUTES = [
  "name",
  "state",
  "host",
  "port",
  "tls",
  "nickname",
  "username",
  "realname",
  "pass",
  "error",
] as const;
