import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { probeMediaUrl, shouldProbeUrl } from "../../src/lib/mediaProbe";

vi.mock("../../src/lib/mediaUtils", () => ({
  detectMediaType: vi.fn((url: string) => {
    if (url.endsWith(".mp4")) return "video";
    if (url.endsWith(".mp3")) return "audio";
    if (url.endsWith(".jpg")) return "image";
    if (url.endsWith(".pdf")) return "pdf";
    return null;
  }),
}));

// Helpers to build mock fetch responses
function makeHeaders(headers: Record<string, string>): {
  get: (n: string) => string | null;
  has: (n: string) => boolean;
} {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get: (name: string) => lower[name.toLowerCase()] ?? null,
    has: (name: string) => name.toLowerCase() in lower,
  };
}

function makeResponse(headers: Record<string, string>): Response {
  return {
    headers: makeHeaders(headers),
    ok: true,
    status: 200,
  } as unknown as Response;
}

function makeErrorResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return {
    headers: makeHeaders(headers),
    ok: false,
    status,
  } as unknown as Response;
}

// Use unique URL counters per test to avoid cache collisions
let urlCounter = 0;
function uniqueUrl(suffix = "") {
  return `https://filehost.example.com/unique${++urlCounter}${suffix}`;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());

  // jsdom doesn't fire loadedmetadata/error on media/image elements for HTTP URLs.
  // Return a stub that immediately fires "error" as a microtask so probeViaMediaElement
  // and probeViaImageElement resolve false without waiting 5 seconds.
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
    if (tagName !== "audio" && tagName !== "video" && tagName !== "img")
      return origCreate(tagName);
    const listeners = new Map<string, (e: Event) => void>();
    const el = {
      preload: "",
      load: vi.fn(),
      set src(value: string) {
        if (value) {
          Promise.resolve().then(() => {
            const cb = listeners.get("error");
            if (cb) cb(new Event("error"));
          });
        }
      },
      get src() {
        return "";
      },
      addEventListener(event: string, cb: (e: Event) => void) {
        listeners.set(event, cb);
      },
    };
    return el as unknown as HTMLElement;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("probeMediaUrl", () => {
  test("video/mp4 content-type → type video, skipped false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "video/mp4",
        "content-length": "1000000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("video");
    expect(result?.skipped).toBe(false);
    expect(result?.size).toBe(1000000);
  });

  test("audio/mpeg content-type → type audio", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "audio/mpeg",
        "content-length": "500000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("audio");
    expect(result?.streamable).toBe(false);
  });

  test("HEAD 405 then GET audio → type audio (HEAD-hostile streaming server)", async () => {
    vi.mocked(fetch)
      // HEAD rejected with an error body — must not be trusted as the real type
      .mockResolvedValueOnce(
        makeErrorResponse(405, { "content-type": "application/json" }),
      )
      // GET (Range: bytes=0-0) reveals the actual audio stream
      .mockResolvedValueOnce(makeResponse({ "content-type": "audio/mp3" }));
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("audio");
    expect(result?.streamable).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });

  test("HEAD 404 → no GET retry, null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeErrorResponse(404, { "content-type": "text/html" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
    // 404 won't improve on GET, so only the HEAD request is made
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  test("image/jpeg content-type → type image", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "image/jpeg", "content-length": "50000" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("image");
  });

  test("application/pdf content-type → type pdf", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "application/pdf",
        "content-length": "200000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("pdf");
  });

  test("unknown content-type → null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "text/html" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("mixed-case content-type normalized → classified correctly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "Video/MP4",
        "content-length": "1000000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("video");
  });

  test("mixed-case SVG content-type → null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "Image/SVG+XML" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("content-type with charset stripped correctly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "audio/mpeg; charset=utf-8",
        "content-length": "100000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.type).toBe("audio");
  });

  test("video > 50 MB → skipped: true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "video/mp4",
        "content-length": String(52_428_801),
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.skipped).toBe(true);
    expect(result?.type).toBe("video");
  });

  test("video exactly 50 MB → skipped: false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "video/mp4",
        "content-length": String(52_428_800),
      }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.skipped).toBe(false);
  });

  test("audio without content-length → streamable: true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "audio/ogg" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result?.streamable).toBe(true);
    expect(result?.size).toBeUndefined();
  });

  test("404 response → null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      headers: makeHeaders({ "content-type": "text/html" }),
      ok: false,
      status: 404,
    } as unknown as Response);
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("network error → null", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("image/svg+xml content-type → null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "image/svg+xml" }),
    );
    const result = await probeMediaUrl(uniqueUrl(".svg"));
    expect(result).toBeNull();
  });

  test("audio/mpegurl content-type → null (HLS MIME)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "audio/mpegurl" }),
    );
    const result = await probeMediaUrl(uniqueUrl(".m3u8"));
    expect(result).toBeNull();
  });

  test("application/vnd.apple.mpegurl content-type → null (HLS MIME)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "application/vnd.apple.mpegurl" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("application/dash+xml content-type → null (DASH MIME)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ "content-type": "application/dash+xml" }),
    );
    const result = await probeMediaUrl(uniqueUrl());
    expect(result).toBeNull();
  });

  test("fetch fails + .m3u extension → null", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl(".m3u"));
    expect(result).toBeNull();
  });

  test(".svg URL with video/mp4 content-type → type video (HEAD wins over extension)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        "content-type": "video/mp4",
        "content-length": "1000000",
      }),
    );
    const result = await probeMediaUrl(uniqueUrl(".svg"));
    expect(result?.type).toBe("video");
  });

  test("fetch fails + .svg extension → null", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl(".svg"));
    expect(result).toBeNull();
  });

  test("fetch fails + .m3u8 extension → null", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl(".m3u8"));
    expect(result).toBeNull();
  });

  test("fetch fails + .mpd extension → null", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl(".mpd"));
    expect(result).toBeNull();
  });

  test("fetch fails + all element probes fail + .pdf URL → type pdf (extension fallback)", async () => {
    // Simulates Chrome/Firefox: CORS blocks HEAD, <img> rejects PDFs → extension fallback.
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await probeMediaUrl(uniqueUrl(".pdf"));
    expect(result?.type).toBe("pdf");
    expect(result?.skipped).toBe(false);
  });

  test("fetch fails + image probe succeeds + .pdf URL → type pdf (WebKit PDF-in-img)", async () => {
    // WebKit renders PDFs inside <img>, so probeViaImageElement returns true for PDF URLs.
    // We must still classify these as "pdf" so the modal uses the PDF viewer.
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    // Override createElement so <img> fires "load" (not "error") for this test.
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "img") return origCreate(tag);
      const listeners = new Map<string, (e: Event) => void>();
      return {
        set src(value: string) {
          if (value)
            Promise.resolve().then(() =>
              listeners.get("load")?.(new Event("load")),
            );
        },
        get src() {
          return "";
        },
        addEventListener(ev: string, cb: (e: Event) => void) {
          listeners.set(ev, cb);
        },
      } as unknown as HTMLElement;
    });

    const result = await probeMediaUrl(uniqueUrl(".pdf"));
    expect(result?.type).toBe("pdf");
  });

  test("timeout after 5 s → null", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const promise = probeMediaUrl(uniqueUrl());
    vi.advanceTimersByTime(5001);
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  test("cache hit: fetch called only once for same URL", async () => {
    const url = uniqueUrl();
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({
        "content-type": "audio/mpeg",
        "content-length": "100000",
      }),
    );
    await probeMediaUrl(url);
    await probeMediaUrl(url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("cache eviction: oldest entry removed when size exceeds 200", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({ "content-type": "audio/mpeg" }),
    );

    // Fill cache: urls 0..199 (200 entries)
    const base = uniqueUrl();
    const firstUrl = base;
    await probeMediaUrl(firstUrl);

    for (let i = 1; i < 200; i++) {
      await probeMediaUrl(uniqueUrl());
    }

    // 201st entry triggers eviction of the first URL
    vi.mocked(fetch).mockResolvedValue(
      makeResponse({ "content-type": "audio/mpeg" }),
    );
    await probeMediaUrl(uniqueUrl());

    const callsBefore = vi.mocked(fetch).mock.calls.length;
    // firstUrl was evicted — should trigger a new fetch
    await probeMediaUrl(firstUrl);
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore + 1);
  });
});

describe("shouldProbeUrl", () => {
  test("returns false for URL with detectable extension", () => {
    // detectMediaType mock returns 'video' for .mp4
    expect(shouldProbeUrl("https://example.com/video.mp4")).toBe(false);
    expect(shouldProbeUrl("https://example.com/audio.mp3")).toBe(false);
    expect(shouldProbeUrl("https://example.com/image.jpg")).toBe(false);
  });

  test("returns true for URL with no detectable extension", () => {
    // detectMediaType mock returns null for extensionless URLs
    expect(shouldProbeUrl("https://radio.example.com/stream")).toBe(true);
    expect(shouldProbeUrl("https://files.example.com/abc123")).toBe(true);
    expect(shouldProbeUrl("https://example.com/page")).toBe(true);
  });
});
