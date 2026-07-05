/**
 * Utility functions for parsing IRC URLs (irc:// and ircs://)
 * Supports extracting server details, channels, and connection parameters
 */

export interface ParsedIrcUrl {
  host: string;
  port: number;
  scheme: "irc" | "ircs";
  channels: string[];
  nick?: string;
  password?: string;
}

/**
 * Parses an IRC URL and extracts connection details
 *
 * @param url - The IRC URL to parse (irc:// or ircs://)
 * @param defaultNick - Default nickname to use if none specified in URL
 * @returns Parsed IRC connection details
 *
 * @example
 * ```typescript
 * const parsed = parseIrcUrl('ircs://irc.libera.chat:6697/#channel1,channel2?nick=user&password=pass');
 * // Returns: {
 * //   host: 'irc.libera.chat',
 * //   port: 6697,
 * //   scheme: 'ircs',
 * //   channels: ['#channel1', '#channel2'],
 * //   nick: 'user',
 * //   password: 'pass'
 * // }
 * ```
 */
export function parseIrcUrl(url: string, defaultNick = "user"): ParsedIrcUrl {
  // Sanitize URL by removing trailing punctuation commonly found in chat text
  const sanitizedUrl = url.trim().replace(/[),.;:]+$/, "");

  // Determine scheme
  const scheme = sanitizedUrl.startsWith("ircs://") ? "ircs" : "irc";

  // Manual parsing for Android compatibility (new URL() doesn't support custom schemes on Android)
  let host: string;
  let port: number;
  let channels: string[] = [];
  let nick = defaultNick;
  let password: string | undefined;

  // Remove protocol prefix
  const withoutProtocol = sanitizedUrl.replace(/^ircs?:\/\//, "");

  // Split into main part and query string
  const [mainPart, queryString] = withoutProtocol.split("?");

  // Remove trailing slash from main part for cleaner parsing
  const cleanMainPart = mainPart.replace(/\/$/, "");

  // Parse the main part (host:port/channels)
  const pathMatch = cleanMainPart.match(/^([^:/]+)(?::(\d+))?(?:\/(.+))?$/);

  if (pathMatch) {
    host = pathMatch[1];
    port = pathMatch[2]
      ? Number.parseInt(pathMatch[2], 10)
      : scheme === "ircs"
        ? 6697
        : 6667;

    // Parse channels from path
    if (pathMatch[3]) {
      const rawChannelStr = pathMatch[3];
      channels = rawChannelStr
        .split(",")
        .filter(Boolean)
        .map((c) => decodeURIComponent(c))
        .map((c) => normalizeChannelName(c));
    }
  } else {
    // Fallback for malformed URLs
    host = cleanMainPart.split(":")[0] || "";
    port = scheme === "ircs" ? 6697 : 6667;
  }

  // Parse query parameters manually
  if (queryString) {
    const params = new URLSearchParams(queryString);
    nick = params.get("nick") || defaultNick;
    password = params.get("password") || undefined;
  }

  return {
    host,
    port,
    scheme: scheme as "irc" | "ircs",
    channels,
    nick,
    password,
  };
}

/**
 * Normalizes a channel name by ensuring it has the correct prefix
 * Adds '#' prefix if the channel doesn't start with a valid IRC channel prefix
 *
 * @param channelName - The channel name to normalize
 * @returns Normalized channel name with proper prefix
 */
export function normalizeChannelName(channelName: string): string {
  const validPrefixes = ["#", "&", "+", "!"];
  const hasValidPrefix = validPrefixes.some((prefix) =>
    channelName.startsWith(prefix),
  );

  return hasValidPrefix ? channelName : `#${channelName}`;
}

/**
 * Validates if a URL is a valid IRC URL
 *
 * @param url - The URL to validate
 * @returns true if the URL is a valid IRC URL
 */
export function isValidIrcUrl(url: string): boolean {
  try {
    // Manual validation for Android compatibility
    const trimmed = url.trim();
    if (!trimmed.startsWith("irc://") && !trimmed.startsWith("ircs://")) {
      return false;
    }

    const parsed = parseIrcUrl(trimmed);
    return parsed.host !== "" && parsed.port > 0;
  } catch {
    return false;
  }
}

/**
 * Constructs an IRC URL from connection details
 *
 * @param details - The IRC connection details
 * @returns Formatted IRC URL string
 */
export function constructIrcUrl(details: ParsedIrcUrl): string {
  let url = `${details.scheme}://${details.host}:${details.port}`;

  if (details.channels.length > 0) {
    // Remove # prefixes from channels for clean URL construction
    const cleanChannels = details.channels
      .map((channel) =>
        channel.startsWith("#") ? channel.substring(1) : channel,
      )
      .join(",");
    url += `/${cleanChannels}`;
  } else {
    url += "/";
  }

  const params = new URLSearchParams();
  if (details.nick) {
    params.set("nick", details.nick);
  }
  if (details.password) {
    params.set("password", details.password);
  }

  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  return url;
}
