// Minimal IRCv3 line parser for the Node test peer. Only handles what
// registration, CAP negotiation and TAGMSG signaling actually need --
// this is not a general-purpose IRC client parser.

import { unescapeIrcTagValue } from "./voiceSignaling.mjs";

// Parses one raw line (no trailing CR/LF) into
// { tags, prefix, command, params }. `command` is upper-cased; `params`
// includes the trailing (`:...`) parameter, if any, as its own entry.
export function parseIrcLine(raw) {
  let rest = raw;
  /** @type {Record<string, string>} */
  const tags = {};

  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    const tagBlock = sp === -1 ? rest.slice(1) : rest.slice(1, sp);
    rest = sp === -1 ? "" : rest.slice(sp + 1);
    for (const pair of tagBlock.split(";")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) {
        tags[pair] = "";
      } else {
        tags[pair.slice(0, eq)] = unescapeIrcTagValue(pair.slice(eq + 1));
      }
    }
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = sp === -1 ? rest.slice(1) : rest.slice(1, sp);
    rest = sp === -1 ? "" : rest.slice(sp + 1);
  }

  const params = [];
  while (rest.length > 0) {
    if (rest.startsWith(":")) {
      params.push(rest.slice(1));
      rest = "";
      break;
    }
    const sp = rest.indexOf(" ");
    if (sp === -1) {
      params.push(rest);
      rest = "";
      break;
    }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }

  const command = (params.shift() ?? "").toUpperCase();
  return { tags, prefix, command, params };
}

// The nick half of a `nick!user@host` prefix (or the bare prefix, e.g.
// a server name, when there's no `!`).
export function prefixNick(prefix) {
  return prefix.split("!")[0] ?? "";
}
