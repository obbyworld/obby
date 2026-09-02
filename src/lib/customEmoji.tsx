// IRCv3 draft/custom-emoji client implementation.
//
// Servers advertise a pack URL via the `draft/EMOJI` ISUPPORT token.
// Channel ops can also publish per-channel packs via the `draft/emoji`
// channel metadata key.  This module fetches and caches both, and
// exposes a renderer that swaps `:shortcode:` for an <img>.
//
// URL trust: the pack URL is given to us by the server we just
// authenticated with, so it inherits server trust.  Image URLs *inside*
// the pack are not auto-loaded; only when a message references
// `:shortcode:` do we render the <img>, and the browser will fetch it
// then.  We do not probe these URLs with HEAD/GET, unlike the ad-hoc
// media probe path.

import * as React from "react";

export interface EmojiEntry {
  url: string;
  alt?: string;
}

export interface EmojiPack {
  id: string;
  name: string;
  description?: string;
  authors?: string[];
  homepage?: string;
  required?: string[];
  emoji: Record<string, EmojiEntry>;
}

// In-memory cache keyed by absolute pack URL.  Multiple servers/channels
// can point at the same URL and we want exactly one fetch per URL per
// session.  60s TTL is the same Cache-Control max-age the backend uses
// for the public document.
type CacheEntry =
  | { state: "pending"; promise: Promise<EmojiPack[] | null> }
  | { state: "ok"; packs: EmojiPack[]; fetchedAt: number }
  | { state: "err"; error: unknown; fetchedAt: number };

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function isExpired(e: CacheEntry): boolean {
  if (e.state === "pending") return false;
  return Date.now() - e.fetchedAt > TTL_MS;
}

export async function fetchEmojiPacks(
  url: string,
): Promise<EmojiPack[] | null> {
  if (!url) return null;
  const existing = CACHE.get(url);
  if (existing && !isExpired(existing)) {
    if (existing.state === "ok") return existing.packs;
    if (existing.state === "pending") return existing.promise;
    return null;
  }

  const promise = (async () => {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        CACHE.set(url, {
          state: "err",
          error: new Error(`pack fetch ${res.status}`),
          fetchedAt: Date.now(),
        });
        return null;
      }
      const body = await res.json();
      const packs: EmojiPack[] = Array.isArray(body) ? body : [body];
      CACHE.set(url, { state: "ok", packs, fetchedAt: Date.now() });
      return packs;
    } catch (err) {
      CACHE.set(url, { state: "err", error: err, fetchedAt: Date.now() });
      return null;
    }
  })();

  CACHE.set(url, { state: "pending", promise });
  return promise;
}

export function clearEmojiPackCache(): void {
  CACHE.clear();
}

// Walk loaded packs in priority order and emit one entry per shortcode.
// First URL wins for shortcode collisions, so callers should pass
// channel-scoped pack URL(s) ahead of the network pack URL.
export interface ResolvedShortcode extends EmojiEntry {
  shortcode: string;
  packId: string;
  packName: string;
}

function collectShortcodesUnsafe(
  packUrls: ReadonlyArray<string | undefined>,
): ResolvedShortcode[] {
  const out: ResolvedShortcode[] = [];
  const seen = new Set<string>();
  for (const url of packUrls) {
    if (!url) continue;
    const entry = CACHE.get(url);
    if (!entry || entry.state !== "ok") continue;
    for (const pack of entry.packs) {
      for (const [shortcode, e] of Object.entries(pack.emoji ?? {})) {
        if (seen.has(shortcode)) continue;
        seen.add(shortcode);
        out.push({
          shortcode,
          url: e.url,
          alt: e.alt,
          packId: pack.id,
          packName: pack.name,
        });
      }
    }
  }
  return out;
}

// React hook: gather all packs visible from a (server, channel) viewpoint
// and expose a synchronous resolver.  Channel-scoped packs win over the
// network pack when shortcodes collide.
//
// The hook also returns the flat shortcode list so consumers like the
// emoji picker / autocomplete can enumerate without touching the
// in-memory cache directly.
export function useEmojiResolver(packUrls: ReadonlyArray<string | undefined>): {
  resolve: (shortcode: string) => EmojiEntry | null;
  shortcodes: ResolvedShortcode[];
} {
  // Callers build the URL list inline, so the joined string is the only stable
  // identity to key off. A resolver with a new identity each render re-runs the
  // markdown pass for every visible message.
  const key = packUrls.filter(Boolean).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined key is what makes the same set of URLs one identity
  const urls = React.useMemo(
    () => packUrls.filter((u): u is string => !!u),
    [key],
  );
  const [revision, force] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all(urls.map((u) => fetchEmojiPacks(u)))
      .then(() => {
        if (!cancelled) force();
      })
      .catch(() => {
        // fetchEmojiPacks already swallows errors into the cache.
      });
    return () => {
      cancelled = true;
    };
  }, [urls]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a pack finishing its load changes what the same URLs resolve to
  const resolve = React.useCallback(
    (shortcode: string) => {
      for (const url of urls) {
        const entry = CACHE.get(url);
        if (!entry || entry.state !== "ok") continue;
        for (const pack of entry.packs) {
          const e = pack.emoji?.[shortcode];
          if (e) return e;
        }
      }
      return null;
    },
    [urls, revision],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a pack finishing its load changes which shortcodes exist
  const shortcodes = React.useMemo(
    () => collectShortcodesUnsafe(urls),
    [urls, revision],
  );

  return { resolve, shortcodes };
}

// Synchronous accessor for callers that aren't in a React tree.  Only
// returns shortcodes from packs already in the cache; doesn't trigger
// fetches.
export function getLoadedShortcodes(
  packUrls: ReadonlyArray<string | undefined>,
): ResolvedShortcode[] {
  return collectShortcodesUnsafe(packUrls);
}

const SHORTCODE_RX = /:([A-Za-z0-9._-]+):/g;

/**
 * Render `text` with `:shortcode:` runs swapped out for <img> tags.
 *
 * Non-emoji segments are passed back through the caller-supplied
 * `renderText` callback so existing IRC formatting (mirc colors,
 * markdown, etc.) keeps working — we don't try to re-implement the
 * formatter inside the emoji pass.
 *
 * Unknown shortcodes are left as plain text so users see what they
 * typed instead of a silent no-op.
 */
export function renderWithCustomEmoji(
  text: string,
  resolve: (shortcode: string) => EmojiEntry | null,
  renderText: (subtext: string, key: string) => React.ReactNode,
  keyPrefix = "ce",
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(SHORTCODE_RX)) {
    const idx = match.index;
    if (idx === undefined) continue;
    const hit = resolve(match[1]);
    if (!hit) continue;
    if (idx > last) {
      parts.push(renderText(text.slice(last, idx), `${keyPrefix}-t-${i}`));
    }
    parts.push(
      <img
        key={`${keyPrefix}-e-${i++}`}
        src={hit.url}
        alt={hit.alt ?? `:${match[1]}:`}
        title={`:${match[1]}:`}
        className="custom-emoji inline-block align-text-bottom"
        style={{ height: "1.25em", width: "auto" }}
        loading="lazy"
        decoding="async"
      />,
    );
    last = idx + match[0].length;
  }
  if (parts.length === 0) return renderText(text, `${keyPrefix}-only`);
  if (last < text.length) {
    parts.push(renderText(text.slice(last), `${keyPrefix}-t-${i}`));
  }
  return parts;
}
