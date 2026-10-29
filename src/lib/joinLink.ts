import { normalizeChannelName } from "./ircUrlParser";

export interface JoinLink {
  host: string;
  port: number;
  channels: string[];
  nick?: string;
}

const SCHEME = /^(wss?|ircs?):\/\//i;

/**
 * Parses the fragment of a web link that opens a server and its channels:
 * `[name|][wss|ircs://]host[:port][/path][#chan,#chan][?nick=…]`. This is the
 * Kiwi IRC fragment format, plus channels in the path for irc(s) as in the IRC
 * URL draft. A link without a scheme means wss.
 */
export function parseJoinLink(fragment: string): JoinLink | null {
  let rest: string;
  try {
    rest = decodeURIComponent(fragment.replace(/^#/, "")).trim();
  } catch {
    return null;
  }
  // We drop a link's display name so the user only ever sees the real hostname.
  rest = rest.replace(/^[^|/]*\|/, "");
  const scheme = rest.match(SCHEME)?.[1].toLowerCase() ?? "wss";
  rest = rest.replace(SCHEME, "");
  if (!rest) return null;

  let url: URL;
  try {
    url = new URL(`https://${rest}`);
  } catch {
    return null;
  }
  if (!url.hostname) return null;

  const isIrcScheme = scheme.startsWith("irc");
  // Kiwi puts the query after the channels, where the URL parser counts it as part of the hash.
  const [hashChannels, hashQuery] = url.hash.split("?");
  const params = new URLSearchParams(url.search || hashQuery);
  const pathChannels = isIrcScheme ? url.pathname.split(/[/,]/) : [];
  const channels = [...pathChannels, ...hashChannels.split(",")]
    .map((name) => decodeChannel(name).trim())
    .filter((name) => name && name !== "#")
    .map(normalizeChannelName);

  // The browser only speaks WebSocket, so an irc(s) link connects to the
  // server's wss endpoint on 443.
  const port = !isIrcScheme && url.port ? Number(url.port) : 443;
  const path = isIrcScheme || url.pathname === "/" ? "" : url.pathname;
  return {
    host: `wss://${url.hostname}${port === 443 ? "" : `:${port}`}${path}`,
    port,
    channels,
    nick: params.get("nick") || undefined,
  };
}

// The URL parser encodes non-ASCII channel names again, so we decode each one.
function decodeChannel(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function hostnameOf(host: string): string {
  try {
    return new URL(`https://${host.replace(SCHEME, "")}`).hostname;
  } catch {
    return host.toLowerCase();
  }
}
