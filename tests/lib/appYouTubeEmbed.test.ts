import { describe, expect, test, vi } from "vitest";

const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }));
vi.mock("../../src/lib/platformUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/platformUtils")>()),
  isTauri: platform.isTauri,
}));

import { getAppYouTubeEmbedUrl } from "../../src/lib/mediaUtils";

describe("YouTube in the installed apps", () => {
  test("plays watch, short and youtu.be links through the web origin page", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(getAppYouTubeEmbedUrl(url)).toBe(
        "https://hello.obby.world/youtube-embed.html?v=dQw4w9WgXcQ",
      );
    }
  });

  test("leaves other links and the web build alone", () => {
    expect(getAppYouTubeEmbedUrl("https://vimeo.com/1")).toBeNull();
    platform.isTauri.mockReturnValueOnce(false);
    expect(
      getAppYouTubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
  });
});
