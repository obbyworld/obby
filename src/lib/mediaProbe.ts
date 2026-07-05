import { detectMediaType, type MediaType } from "./mediaUtils";

export interface ProbeResult {
  type: MediaType;
  size?: number;
  streamable: boolean; // audio/* with no Content-Length
  skipped: boolean; // video > 50 MB — show link, not preview
}

const cache = new Map<string, ProbeResult | null>();
const keyOrder: string[] = [];
const MAX_CACHE_SIZE = 200;

function cacheSet(url: string, result: ProbeResult | null): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = keyOrder.shift();
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, result);
  keyOrder.push(url);
}

/** Returns true if the URL has no detectable type and should be HEAD-probed. */
export function shouldProbeUrl(url: string): boolean {
  return detectMediaType(url) === null;
}

/**
 * Synchronous cache lookup. Returns:
 *   undefined   — URL has never been probed
 *   null        — URL was probed but is not a media file
 *   ProbeResult — URL was probed and is a media file
 */
export function getCachedProbeResult(
  url: string,
): ProbeResult | null | undefined {
  if (!cache.has(url)) return undefined;
  return cache.get(url) ?? null;
}

interface HttpProbe {
  contentType: string;
  contentLength?: number;
  ok: boolean;
  status: number;
}

async function tryHttpFetch(
  url: string,
  method: "HEAD" | "GET",
): Promise<HttpProbe | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const headers: Record<string, string> =
      // Range: bytes=0-0 avoids downloading the full file body
      method === "GET" ? { Range: "bytes=0-0" } : {};
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const contentType = (response.headers.get("Content-Type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const lengthHeader = response.headers.get("Content-Length");
    const contentLength =
      lengthHeader !== null ? Number(lengthHeader) : undefined;
    return {
      contentType,
      contentLength,
      ok: response.ok,
      status: response.status,
    };
  } catch (_err) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Reads the Content-Type via HEAD, falling back to a ranged GET. Some streaming
 * servers (e.g. Icecast, suno) reject HEAD with 405/501 but answer GET correctly,
 * so a non-2xx HEAD must not be trusted as the resource's real type.
 */
async function fetchContentType(
  url: string,
): Promise<{ contentType: string; contentLength?: number } | null> {
  const head = await tryHttpFetch(url, "HEAD");
  if (head?.ok && head.contentType) {
    return { contentType: head.contentType, contentLength: head.contentLength };
  }
  // Only the GET retry can help when HEAD threw (CORS), was rejected as a method
  // (405/501), or returned 2xx without a type. A 404/410/5xx won't improve on GET.
  if (head !== null && !head.ok && head.status !== 405 && head.status !== 501) {
    return null;
  }
  const get = await tryHttpFetch(url, "GET");
  if (get?.ok && get.contentType) {
    return { contentType: get.contentType, contentLength: get.contentLength };
  }
  return null;
}

/** Maps a Content-Type to a ProbeResult. Single source of truth for media classification. */
function classifyContentType(
  contentType: string,
  contentLength?: number,
): ProbeResult | null {
  // SVG/HLS/DASH can reach third-party servers outside CORS (old WebKit sub-resources, AVFoundation).
  if (
    contentType === "image/svg+xml" ||
    contentType === "audio/mpegurl" ||
    contentType === "application/vnd.apple.mpegurl" ||
    contentType === "application/dash+xml"
  )
    return null;

  let type: MediaType;
  if (contentType.startsWith("video/")) {
    type = "video";
  } else if (contentType.startsWith("audio/")) {
    type = "audio";
  } else if (contentType.startsWith("image/")) {
    type = "image";
  } else if (contentType === "application/pdf") {
    type = "pdf";
  } else {
    return null;
  }

  if (
    type === "video" &&
    contentLength !== undefined &&
    contentLength > 52_428_800
  ) {
    return { type, size: contentLength, streamable: false, skipped: true };
  }

  const streamable = type === "audio" && contentLength === undefined;
  return { type, size: contentLength, streamable, skipped: false };
}

export async function probeMediaUrl(url: string): Promise<ProbeResult | null> {
  if (cache.has(url)) return cache.get(url) ?? null;

  // Primary path: HTTP Content-Type is the single source of truth.
  // HEAD is tried first; GET fallback covers servers that reject HEAD (e.g. Icecast).
  const fetched = await fetchContentType(url);
  if (fetched) {
    const result = classifyContentType(
      fetched.contentType,
      fetched.contentLength,
    );
    cacheSet(url, result);
    return result;
  }

  // HTTP failed (CORS, network error, timeout). Trust the file extension before
  // media-element probing: <video> elements can load audio-only files (.mp3 fires
  // loadedmetadata), which would misclassify audio as video when HEAD is blocked.
  //
  // When we can't verify the content type, block formats that can reach third-party
  // servers outside CORS (SVG sub-resources on old WebKit, HLS/DASH via AVFoundation).
  const urlLower = url.split("?")[0].split("#")[0].toLowerCase();
  if (/\.(svg|m3u8?|mpd)$/.test(urlLower)) {
    cacheSet(url, null);
    return null;
  }
  const extType = detectMediaType(url);
  if (
    extType === "audio" ||
    extType === "video" ||
    extType === "pdf" ||
    extType === "image"
  ) {
    const result: ProbeResult = {
      type: extType,
      streamable: extType === "audio",
      skipped: false,
    };
    cacheSet(url, result);
    return result;
  }

  // Last resort: media element probes for extensionless URLs where HTTP is blocked by CORS.
  // probeViaVideoElement returns true only when videoWidth > 0 (actual video track),
  // correctly excluding audio-only streams that load in <video> but have videoWidth=0.
  const isVideo = await probeViaVideoElement(url);
  if (isVideo) {
    const result: ProbeResult = {
      type: "video",
      streamable: false,
      skipped: false,
    };
    cacheSet(url, result);
    return result;
  }

  const isAudio = await probeViaAudioElement(url);
  if (isAudio) {
    const result: ProbeResult = {
      type: "audio",
      streamable: true,
      skipped: false,
    };
    cacheSet(url, result);
    return result;
  }

  // Image elements load cross-origin without CORS restrictions — use as last resort.
  // Special case: WebKit (Safari/WKWebView) renders PDFs inside <img>, so
  // probeViaImageElement succeeds for PDF URLs. Check the extension afterward to
  // correctly classify them as "pdf" so the PDF viewer is shown instead of image viewer.
  const isImage = await probeViaImageElement(url);
  if (isImage) {
    const isPdf = detectMediaType(url) === "pdf";
    const result: ProbeResult = {
      type: isPdf ? "pdf" : "image",
      streamable: false,
      skipped: false,
    };
    cacheSet(url, result);
    return result;
  }

  // All probes failed. Trust the file extension as a last resort for PDF URLs so
  // react-pdf can attempt to render them (e.g. Chrome/Firefox where <img> rejects PDFs).
  if (detectMediaType(url) === "pdf") {
    const result: ProbeResult = {
      type: "pdf",
      streamable: false,
      skipped: false,
    };
    cacheSet(url, result);
    return result;
  }

  cacheSet(url, null);
  return null;
}

// Tries to load a URL as an image using a temporary img element.
// Browsers load cross-origin images without CORS restrictions, so this works
// even when fetch() is blocked. An HTML response causes onerror to fire
// because the browser cannot decode HTML as image data.
function probeViaImageElement(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      img.src = "";
      resolve(result);
    };
    img.addEventListener("load", () => done(true), { once: true });
    img.addEventListener("error", () => done(false), { once: true });
    setTimeout(() => done(false), 5_000);
    img.src = url;
  });
}

// Returns true only when the URL has actual video tracks (videoWidth > 0 after
// loadedmetadata). Audio-only files and streams load fine in a <video> element
// but always report videoWidth=0, so they are correctly excluded.
function probeViaVideoElement(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      el.src = "";
      el.load();
      resolve(result);
    };
    el.addEventListener("loadedmetadata", () => done(el.videoWidth > 0), {
      once: true,
    });
    el.addEventListener("error", () => done(false), { once: true });
    setTimeout(() => done(false), 5_000);
    el.src = url;
  });
}

// Returns true when the URL can be decoded as audio.
// This bypasses CORS restrictions that block fetch() for cross-origin servers.
function probeViaAudioElement(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      el.src = "";
      el.load();
      resolve(result);
    };
    // loadedmetadata fires for regular files; canplay also catches live streams
    // where some browsers skip straight to buffering without a discrete metadata event.
    el.addEventListener("loadedmetadata", () => done(true), { once: true });
    el.addEventListener("canplay", () => done(true), { once: true });
    el.addEventListener("error", () => done(false), { once: true });
    setTimeout(() => done(false), 5_000);
    el.src = url;
  });
}
