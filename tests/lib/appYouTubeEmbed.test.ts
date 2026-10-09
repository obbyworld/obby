import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => 51234),
}));

const loadUnder = async (protocol: string) => {
  vi.resetModules();
  vi.stubGlobal("location", { ...window.location, protocol });
  const { getAppYouTubeEmbedUrl } = await import("../../src/lib/mediaUtils");
  await Promise.resolve();
  return getAppYouTubeEmbedUrl;
};

describe("YouTube under the tauri: scheme", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("plays watch, short and youtu.be links through the loopback player page", async () => {
    const getAppYouTubeEmbedUrl = await loadUnder("tauri:");
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(getAppYouTubeEmbedUrl(url)).toBe(
        "http://127.0.0.1:51234/youtube-embed.html?v=dQw4w9WgXcQ",
      );
    }
    expect(getAppYouTubeEmbedUrl("https://vimeo.com/1")).toBeNull();
  });

  test("leaves http origins on the regular embed", async () => {
    const getAppYouTubeEmbedUrl = await loadUnder("http:");
    expect(
      getAppYouTubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
  });
});
