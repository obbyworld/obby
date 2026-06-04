import type { Message } from "../types/index";
import {
  isAbsoluteHttpUrl,
  isUrlFromFilehost,
  isUrlFromTrustedSource,
} from "./ircUtils";
import { stripIrcFormatting } from "./messageFormatter";

export type MediaType = "image" | "video" | "audio" | "pdf" | "embed";

export interface MediaEntry {
  url: string;
  type: MediaType | null; // null = type unknown, needs HEAD probe
}

export const TRUSTED_EMBED_DOMAINS: Record<string, MediaType> = {
  "youtube.com": "embed",
  "youtu.be": "embed",
  "vimeo.com": "embed",
  "soundcloud.com": "embed",
  "open.spotify.com": "embed",
  "media.tenor.com": "image",
  "tenor.com": "image",
  "media.giphy.com": "image",
  "giphy.com": "image",
  "imgur.com": "image",
};

/** Extract and normalise the hostname from a URL, stripping a leading www. Returns null on parse failure. */
function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isEmbeddablePath(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname;

    if (host === "youtube.com") {
      return (
        (path === "/watch" && !!u.searchParams.get("v")) ||
        /^\/shorts\/[\w-]+/.test(path) ||
        /^\/live\/[\w-]+/.test(path)
      );
    }
    if (host === "youtu.be") {
      // all youtu.be paths are video short-links
      return path.length > 1;
    }
    if (host === "vimeo.com") {
      // video IDs are numeric; channel/group/user pages are not
      return /^\/\d+/.test(path);
    }
    if (host === "soundcloud.com") {
      // tracks are artist/track (2 segments); artist pages are just /artist
      return path.split("/").filter(Boolean).length >= 2;
    }
    return true;
  } catch {
    return false;
  }
}

/** Detect media type from a URL. Returns null if not recognised. */
export function detectMediaType(url: string): MediaType | null {
  const hostname = extractHostname(url);
  if (hostname === null) return null;

  for (const domain of Object.keys(TRUSTED_EMBED_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      const type = TRUSTED_EMBED_DOMAINS[domain];
      if (type === "embed" && !isEmbeddablePath(url)) return null;
      return type;
    }
  }

  const lower = url.toLowerCase().split("?")[0].split("#")[0];

  if (/\.(mp4|webm|mov|ogv)$/.test(lower)) return "video";
  if (/\.(mp3|ogg|wav|flac|aac|m4a)$/.test(lower)) return "audio";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(lower)) return "image";

  return null;
}

/**
 * Codec support table — checked once via HTMLVideoElement.canPlayType() (no network request).
 * Results are memoized so repeated calls are O(1).
 *
 * | Extension | Container  | Video | Audio | WKWebView (macOS) | Chrome/FF |
 * |-----------|------------|-------|-------|-------------------|-----------|
 * | .mp4      | MPEG-4     | H.264 | AAC   | ✅ always          | ✅         |
 * | .mov      | QuickTime  | H.264 | AAC   | ✅ always          | ✅         |
 * | .m4v      | MPEG-4     | H.264 | AAC   | ✅ always          | ✅         |
 * | .webm     | WebM       | VP9   | Opus  | ⚠️ macOS 11+ only  | ✅         |
 * | .webm     | WebM       | VP8   | Vorbis| ❌ WKWebView        | ✅         |
 * | .ogv      | Ogg        | Theora| Vorbis| ❌ WKWebView        | ✅         |
 * | .mkv      | Matroska   | any   | any   | ❌ WKWebView        | ✅         |
 * | .avi      | AVI        | any   | any   | ❌ WKWebView        | partial   |
 */
const VIDEO_MIME_BY_EXT: Record<string, string[]> = {
  mp4: ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', "video/mp4"],
  m4v: ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', "video/mp4"],
  mov: ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', "video/mp4"],
  webm: [
    'video/webm; codecs="vp9, opus"',
    'video/webm; codecs="vp8"',
    "video/webm",
  ],
  ogv: ['video/ogg; codecs="theora, vorbis"', "video/ogg"],
  mkv: ["video/x-matroska"],
  avi: ["video/x-msvideo"],
};

const _canPlayCache = new Map<string, boolean>();

function _probeCanPlay(mimes: string[]): boolean {
  const el = document.createElement("video");
  // Require "probably" — WKWebView returns "maybe" for VP9/WebM even when it can't reliably decode it.
  return mimes.some((m) => el.canPlayType(m) === "probably");
}

/** Returns false when the platform definitely cannot play the video; true when unknown (optimistic). */
export function canPlayVideoUrl(url: string): boolean {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const mimes = VIDEO_MIME_BY_EXT[ext];
  if (!mimes) return true; // unknown extension — optimistic, let it try
  if (_canPlayCache.has(ext)) return _canPlayCache.get(ext) as boolean;
  const supported = _probeCanPlay(mimes);
  _canPlayCache.set(ext, supported);
  return supported;
}

/** Like detectMediaType but trusted domains only — no extension guessing.
 *  Extension-based URLs get type:null so they are always HEAD-probed at render
 *  time. This lets the server's actual Content-Type override the URL hint
 *  (e.g. a .png path that serves text/html should produce no preview). */
function detectTrustedDomainType(url: string): MediaType | null {
  const hostname = extractHostname(url);
  if (hostname === null) return null;
  for (const domain of Object.keys(TRUSTED_EMBED_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      const type = TRUSTED_EMBED_DOMAINS[domain];
      if (type === "embed" && !isEmbeddablePath(url)) return null;
      return type;
    }
  }
  return null;
}

export function isImageLikeUrl(url: string): boolean {
  return detectMediaType(url) === "image";
}

/** Returns all media entries found in an arbitrary text string, deduplicated by URL.
 *  Trusted-domain URLs (YouTube, Tenor, etc.) get their type pre-set.
 *  All other URLs get type:null so callers can HEAD-probe them. */
export function extractMediaFromText(text: string): MediaEntry[] {
  const content = stripIrcFormatting(text).trim();

  // Single-token string that starts with http — check it directly
  if (!/\s/.test(content) && content.startsWith("http")) {
    const clean = content.replace(/[.,!?;:)>\]*]+$/, "");
    return [{ url: clean, type: detectTrustedDomainType(clean) }];
  }

  const matches = content.match(/https?:\/\/[^\s,]+/gi) ?? [];
  const seen = new Set<string>();
  const entries: MediaEntry[] = [];
  for (const raw of matches) {
    const u = raw.replace(/[.,!?;:)>\]*]+$/, "");
    if (seen.has(u)) continue;
    seen.add(u);
    entries.push({ url: u, type: detectTrustedDomainType(u) });
  }
  return entries;
}

/** Returns all media entries found in a message's content. */
export function extractMediaFromMessage(message: Message): MediaEntry[] {
  return extractMediaFromText(message.content);
}

export interface MediaSettings {
  showSafeMedia: boolean;
  showTrustedSourcesMedia: boolean;
  showExternalContent: boolean;
}

export type MediaVisibilityLevel = 0 | 1 | 2 | 3;
// 0 — Off:      no previews
// 1 — Safe:     server's trusted filehost only
// 2 — Trusted:  filehost + known embed services (YouTube, Vimeo, etc.)
// 3 — External: all URLs are candidates

/** Single source of truth for the enum → MediaSettings conversion. */
export function mediaLevelToSettings(
  level: MediaVisibilityLevel,
): MediaSettings {
  return {
    showSafeMedia: level >= 1,
    showTrustedSourcesMedia: level >= 2,
    showExternalContent: level >= 3,
  };
}

/**
 * Returns a static thumbnail URL for known embed platforms.
 * Currently supports YouTube (CDN thumbnail, no API key needed).
 */
export function getEmbedThumbnailUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtu.be") {
      let videoId: string | null = null;
      if (host === "youtu.be") {
        videoId = u.pathname.slice(1).split("/")[0] || null;
      } else {
        videoId = u.searchParams.get("v");
        if (!videoId) {
          const parts = u.pathname.split("/").filter(Boolean);
          if (parts[0] === "embed" || parts[0] === "shorts")
            videoId = parts[1] ?? null;
        }
      }
      if (videoId) return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

const SPOTIFY_CONTENT_TYPES: Record<string, string> = {
  track: "Track",
  playlist: "Playlist",
  album: "Album",
  episode: "Episode",
  show: "Show",
  artist: "Artist",
};

/**
 * Returns a human-readable fallback label for the mini player before the oEmbed
 * title loads. Pass `short=true` when a brand icon is already visible so the
 * platform name is not repeated ("Playlist" vs "Spotify Playlist").
 */
export function getEmbedFallbackLabel(url: string, short = false): string {
  try {
    const u = new URL(url);
    if (u.hostname === "open.spotify.com") {
      const type = u.pathname.split("/").filter(Boolean)[0] ?? "";
      const content = SPOTIFY_CONTENT_TYPES[type] ?? "";
      return short
        ? content || "Spotify"
        : content
          ? `Spotify ${content}`
          : "Spotify";
    }
  } catch {
    // ignore invalid URLs
  }
  return filenameFromUrl(url) || "embed";
}

export function filenameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

/** Returns true if the given URL should be shown based on current media settings. */
export function canShowMedia(
  url: string,
  settings: MediaSettings,
  filehost?: string | string[] | null,
): boolean {
  if (!url || !isAbsoluteHttpUrl(url)) return false;
  if (settings.showExternalContent) return true;
  if (settings.showSafeMedia) {
    if (filehost && isUrlFromFilehost(url, filehost)) return true;
    for (const trustedUrl of __TRUSTED_MEDIA_URLS__) {
      if (trustedUrl && isUrlFromFilehost(url, trustedUrl)) return true;
    }
  }
  if (settings.showTrustedSourcesMedia) {
    const hostname = extractHostname(url);
    if (hostname === null) return false;
    for (const domain of Object.keys(TRUSTED_EMBED_DOMAINS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
    }
  }
  return false;
}

/** Gates every avatar/icon <img> render. Absolute-URL check is unconditional so
 *  callers cannot forget it (history: relative URLs leaked the user's IP to the app origin). */
export function canShowAvatarUrl(
  url: string | undefined | null,
  serverFilehost: string | string[] | undefined | null,
  settings: MediaSettings,
): boolean {
  if (!url || !isAbsoluteHttpUrl(url)) return false;
  if (settings.showExternalContent) return true;
  if (
    settings.showSafeMedia &&
    isUrlFromTrustedSource(url, serverFilehost ?? undefined)
  )
    return true;
  if (settings.showTrustedSourcesMedia) {
    const hostname = extractHostname(url);
    if (hostname === null) return false;
    for (const domain of Object.keys(TRUSTED_EMBED_DOMAINS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
    }
  }
  return false;
}

/** Returns false only for formats that definitively cannot have an alpha channel.
 *  JPEG and PDF are opaque — PDF pages have solid white backgrounds (WKWebView/Safari
 *  render cross-origin PDFs via <img>, which produces an opaque first-page image).
 *  PNG, GIF, WebP, AVIF, and unknown extensions default to true so the
 *  transparency-grid is preserved as a safe fallback when the format is uncertain. */
export function imageCanHaveTransparency(url: string): boolean {
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  return /\.(png|gif|webp|avif)$/.test(path);
}
