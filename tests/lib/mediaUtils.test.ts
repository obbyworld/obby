import { describe, expect, test } from "vitest";
import { serverFilehosts } from "../../src/lib/ircUtils";
import {
  canShowAvatarUrl,
  canShowMedia,
  detectMediaType,
  extractMediaFromMessage,
  getEmbedThumbnailUrl,
  imageCanHaveTransparency,
  mediaLevelToSettings,
  TRUSTED_EMBED_DOMAINS,
} from "../../src/lib/mediaUtils";
import type { Message } from "../../src/types/index";

function makeMessage(content: string): Message {
  return {
    id: "test-id",
    content,
    userId: "user",
    channelId: "channel",
    serverId: "server",
    timestamp: new Date(),
    type: "message",
    reactions: [],
    replyMessage: null,
    mentioned: [],
  };
}

describe("detectMediaType", () => {
  test("returns 'video' for .mp4 URLs", () => {
    expect(detectMediaType("https://example.com/video.mp4")).toBe("video");
  });
  test("returns 'video' for .webm, .mov, .ogv", () => {
    expect(detectMediaType("https://example.com/video.webm")).toBe("video");
    expect(detectMediaType("https://example.com/video.mov")).toBe("video");
    expect(detectMediaType("https://example.com/video.ogv")).toBe("video");
  });
  test("returns 'audio' for .mp3, .ogg, .wav, .flac, .aac, .m4a", () => {
    expect(detectMediaType("https://example.com/audio.mp3")).toBe("audio");
    expect(detectMediaType("https://example.com/audio.ogg")).toBe("audio");
    expect(detectMediaType("https://example.com/audio.wav")).toBe("audio");
    expect(detectMediaType("https://example.com/audio.flac")).toBe("audio");
    expect(detectMediaType("https://example.com/audio.aac")).toBe("audio");
    expect(detectMediaType("https://example.com/audio.m4a")).toBe("audio");
  });
  test("returns 'pdf' for .pdf URLs", () => {
    expect(detectMediaType("https://example.com/doc.pdf")).toBe("pdf");
  });
  test("returns 'embed' for youtube.com watch URLs", () => {
    expect(detectMediaType("https://www.youtube.com/watch?v=abc")).toBe(
      "embed",
    );
    expect(detectMediaType("https://www.youtube.com/shorts/abc123")).toBe(
      "embed",
    );
    expect(detectMediaType("https://www.youtube.com/live/abc123")).toBe(
      "embed",
    );
  });
  test("returns null for youtube.com channel/user pages", () => {
    expect(
      detectMediaType("https://www.youtube.com/@programmingchaos8957"),
    ).toBeNull();
    expect(
      detectMediaType("https://www.youtube.com/channel/UCxxxxxx"),
    ).toBeNull();
    expect(detectMediaType("https://www.youtube.com/user/username")).toBeNull();
    expect(detectMediaType("https://www.youtube.com/c/channelname")).toBeNull();
    expect(detectMediaType("https://www.youtube.com/watch")).toBeNull();
  });
  test("returns 'embed' for youtu.be", () => {
    expect(detectMediaType("https://youtu.be/abc")).toBe("embed");
  });
  test("returns 'embed' for vimeo.com video URLs", () => {
    expect(detectMediaType("https://vimeo.com/123456")).toBe("embed");
  });
  test("returns null for vimeo.com non-video pages", () => {
    expect(detectMediaType("https://vimeo.com/channels/mychannel")).toBeNull();
    expect(detectMediaType("https://vimeo.com/groups/mygroup")).toBeNull();
  });
  test("returns 'embed' for soundcloud.com track URLs", () => {
    expect(detectMediaType("https://soundcloud.com/artist/track")).toBe(
      "embed",
    );
  });
  test("returns null for soundcloud.com artist pages", () => {
    expect(detectMediaType("https://soundcloud.com/artist")).toBeNull();
  });
  test("returns 'image' for imgur.com image URLs", () => {
    expect(detectMediaType("https://imgur.com/abc.jpg")).toBe("image");
  });
  test("returns 'image' for tenor.com URLs", () => {
    expect(detectMediaType("https://media.tenor.com/abc.gif")).toBe("image");
  });
  test("returns 'image' for standard image extensions", () => {
    expect(detectMediaType("https://example.com/photo.jpg")).toBe("image");
    expect(detectMediaType("https://example.com/photo.png")).toBe("image");
    expect(detectMediaType("https://example.com/photo.webp")).toBe("image");
  });
  test("returns null for unrecognised URLs", () => {
    expect(detectMediaType("https://example.com/page")).toBeNull();
    expect(detectMediaType("not-a-url")).toBeNull();
  });
  test("strips query string before extension check", () => {
    expect(detectMediaType("https://example.com/video.mp4?t=10")).toBe("video");
  });
});

describe("extractMediaFromMessage", () => {
  // Extension-based URLs now return type:null — they are HEAD-probed at render
  // time so the server's Content-Type takes precedence over the URL hint.
  // Only trusted-domain URLs (YouTube, Tenor, etc.) get a pre-set type.

  test("extension-based image URL gets type:null (HEAD-probed)", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/photo.jpg"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      url: "https://example.com/photo.jpg",
      type: null,
    });
  });
  test("extension-based video URL gets type:null (HEAD-probed)", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/clip.mp4"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBeNull();
  });
  test("trusted domain URL gets pre-set type (no HEAD needed)", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://www.youtube.com/watch?v=abc"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("embed");
  });
  test("tenor.com URL gets pre-set image type", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://media.tenor.com/abc.gif"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("image");
  });
  test("extracts multiple URLs from text — all non-trusted get null", () => {
    const entries = extractMediaFromMessage(
      makeMessage(
        "Check this https://example.com/a.jpg and https://example.com/b.mp4",
      ),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBeNull();
    expect(entries[1].type).toBeNull();
  });
  test("deduplicates identical URLs", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/a.jpg https://example.com/a.jpg"),
    );
    expect(entries).toHaveLength(1);
  });
  test("returns null-type entry for URLs with no detectable extension", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/page"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ url: "https://example.com/page", type: null });
  });
  test("strips IRC formatting codes", () => {
    const entries = extractMediaFromMessage(
      makeMessage("\x02https://example.com/photo.jpg\x02"),
    );
    expect(entries).toHaveLength(1);
  });
  test("strips trailing punctuation from URLs", () => {
    const entries = extractMediaFromMessage(
      makeMessage("See https://example.com/photo.jpg."),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("https://example.com/photo.jpg");
  });
  test("strips trailing asterisks from markdown-bold URLs", () => {
    const entries = extractMediaFromMessage(
      makeMessage("look **https://example.com/video.mp4** nice"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("https://example.com/video.mp4");
    expect(entries[0].type).toBeNull();
  });
  test("handles URL with fragment/hash", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/photo.jpg#section"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBeNull();
  });
  test("handles URL with both query and extension", () => {
    const entries = extractMediaFromMessage(
      makeMessage("https://example.com/video.mp4?token=abc123"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBeNull();
  });
  test("grouped path (.png,file.png) sent alone: extracted whole, gets null type", () => {
    // Single-token path: no whitespace, full URL including commas preserved.
    // HEAD probe will return text/html → no preview shown.
    const entries = extractMediaFromMessage(
      makeMessage("https://s.h4ks.com/group/F7d.png,F7e.png,F7f.png"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe(
      "https://s.h4ks.com/group/F7d.png,F7e.png,F7f.png",
    );
    expect(entries[0].type).toBeNull();
  });
  test("grouped path in multi-word message: comma stops URL extraction", () => {
    // Multi-token path uses [^\s,]+ regex — stops at comma.
    // The truncated URL (before comma) also gets type:null → HEAD-probed.
    const entries = extractMediaFromMessage(
      makeMessage("see https://s.h4ks.com/group/F7d.png,F7e.png here"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("https://s.h4ks.com/group/F7d.png");
    expect(entries[0].type).toBeNull();
  });
});

describe("canShowMedia", () => {
  // isUrlFromFilehost expects filehost to be a full URL
  const filehost = "https://files.example.com";

  test("returns true when showExternalContent is true", () => {
    expect(
      canShowMedia(
        "https://anything.com/x.jpg",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: false,
          showExternalContent: true,
        },
        null,
      ),
    ).toBe(true);
  });
  test("returns true for filehost URL when showSafeMedia is true", () => {
    expect(
      canShowMedia(
        `${filehost}/image.jpg`,
        {
          showSafeMedia: true,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        filehost,
      ),
    ).toBe(true);
  });
  test("returns false for filehost URL when showSafeMedia is false", () => {
    expect(
      canShowMedia(
        `${filehost}/image.jpg`,
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        filehost,
      ),
    ).toBe(false);
  });
  test("returns true for trusted domain when showTrustedSourcesMedia is true", () => {
    expect(
      canShowMedia(
        "https://youtube.com/watch?v=x",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: true,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(true);
  });
  test("returns false for trusted domain when showTrustedSourcesMedia is false", () => {
    expect(
      canShowMedia(
        "https://youtube.com/watch?v=x",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(false);
  });
  test("returns false for unknown domain with all settings off", () => {
    expect(
      canShowMedia(
        "https://unknown.example.com/x.jpg",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(false);
  });
  test("returns false for external URL when only showSafeMedia is true (no filehost)", () => {
    expect(
      canShowMedia(
        "https://evil.com/tracker.jpg",
        {
          showSafeMedia: true,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(false);
  });
  test("returns false for external URL when only showSafeMedia is true (with filehost)", () => {
    expect(
      canShowMedia(
        "https://evil.com/tracker.jpg",
        {
          showSafeMedia: true,
          showTrustedSourcesMedia: false,
          showExternalContent: false,
        },
        "https://files.example.com",
      ),
    ).toBe(false);
  });
  test("subdomain of trusted domain is allowed", () => {
    expect(
      canShowMedia(
        "https://cdn.youtube.com/watch?v=x",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: true,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(true);
  });
  test("similar but non-matching domain is denied", () => {
    expect(
      canShowMedia(
        "https://notyoutube.com/watch?v=x",
        {
          showSafeMedia: false,
          showTrustedSourcesMedia: true,
          showExternalContent: false,
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("canShowMedia — filehost trust is origin-based", () => {
  const settings = {
    showSafeMedia: true,
    showTrustedSourcesMedia: false,
    showExternalContent: false,
  };

  // girafiles: the upload endpoint is https://host/api/ but files are served
  // from the host root, so trust must ignore the filehost's path.
  test("trusts a root file when the filehost endpoint has a path", () => {
    expect(
      canShowMedia(
        "https://s.h4ks.com/HrE.txt",
        settings,
        "https://s.h4ks.com/api/",
      ),
    ).toBe(true);
  });

  test("still denies a different origin when the filehost has a path", () => {
    expect(
      canShowMedia(
        "https://evil.com/x.jpg",
        settings,
        "https://s.h4ks.com/api/",
      ),
    ).toBe(false);
  });

  test("accepts a list of filehosts (vendor + tokenless)", () => {
    expect(
      canShowMedia("https://s.h4ks.com/HrE.txt", settings, [
        "https://obby.t3ks.com",
        "https://s.h4ks.com/api/",
      ]),
    ).toBe(true);
  });

  test("an empty filehost list trusts nothing under safe-media", () => {
    expect(canShowMedia("https://s.h4ks.com/x.txt", settings, [])).toBe(false);
  });
});

describe("serverFilehosts", () => {
  test("combines the vendor filehost and the tokenless fileHosts", () => {
    expect(
      serverFilehosts({
        filehost: "https://obby.t3ks.com",
        fileHosts: ["https://s.h4ks.com/api/", "https://x.example/"],
      }),
    ).toEqual([
      "https://obby.t3ks.com",
      "https://s.h4ks.com/api/",
      "https://x.example/",
    ]);
  });

  test("tolerates missing fields and no server", () => {
    expect(serverFilehosts({ fileHosts: ["https://b"] })).toEqual([
      "https://b",
    ]);
    expect(serverFilehosts({ filehost: "https://a" })).toEqual(["https://a"]);
    expect(serverFilehosts({})).toEqual([]);
    expect(serverFilehosts(undefined)).toEqual([]);
  });
});

describe("mediaLevelToSettings", () => {
  test("level 0 disables all media", () => {
    expect(mediaLevelToSettings(0)).toEqual({
      showSafeMedia: false,
      showTrustedSourcesMedia: false,
      showExternalContent: false,
    });
  });

  test("level 1 enables only safe media", () => {
    expect(mediaLevelToSettings(1)).toEqual({
      showSafeMedia: true,
      showTrustedSourcesMedia: false,
      showExternalContent: false,
    });
  });

  test("level 2 enables safe and trusted sources", () => {
    expect(mediaLevelToSettings(2)).toEqual({
      showSafeMedia: true,
      showTrustedSourcesMedia: true,
      showExternalContent: false,
    });
  });

  test("level 3 enables all media", () => {
    expect(mediaLevelToSettings(3)).toEqual({
      showSafeMedia: true,
      showTrustedSourcesMedia: true,
      showExternalContent: true,
    });
  });

  test("level 1 allows filehost URL via canShowMedia", () => {
    const filehost = "https://files.example.com";
    expect(
      canShowMedia(`${filehost}/img.jpg`, mediaLevelToSettings(1), filehost),
    ).toBe(true);
  });

  test("level 1 blocks external URL via canShowMedia", () => {
    expect(
      canShowMedia(
        "https://external.example.com/img.jpg",
        mediaLevelToSettings(1),
        null,
      ),
    ).toBe(false);
  });

  test("level 2 allows YouTube URL via canShowMedia", () => {
    expect(
      canShowMedia(
        "https://youtube.com/watch?v=abc",
        mediaLevelToSettings(2),
        null,
      ),
    ).toBe(true);
  });

  test("level 2 blocks arbitrary external URL via canShowMedia", () => {
    expect(
      canShowMedia(
        "https://external.example.com/img.jpg",
        mediaLevelToSettings(2),
        null,
      ),
    ).toBe(false);
  });

  test("level 3 allows all URLs via canShowMedia", () => {
    expect(
      canShowMedia(
        "https://unknown.example.com/img.jpg",
        mediaLevelToSettings(3),
        null,
      ),
    ).toBe(true);
  });
});

describe("canShowAvatarUrl", () => {
  const filehost = "https://files.example.com";

  // Non-absolute URLs must be blocked at every level — this is the invariant
  // that prevents `<img src=":https://...">` and `<img src="/relative">` from
  // resolving against the app origin and leaking the user's IP.
  test.each([
    [":https://attacker.com/pixel.png"],
    ["/relative/path.png"],
    ["//protocol-relative.example.com/x.png"],
    ["data:image/png;base64,AAAA"],
    ["javascript:alert(1)"],
    [""],
  ])("blocks non-absolute URL %s at level 3", (url) => {
    expect(canShowAvatarUrl(url, filehost, mediaLevelToSettings(3))).toBe(
      false,
    );
  });

  test("blocks null/undefined URL at any level", () => {
    expect(canShowAvatarUrl(null, filehost, mediaLevelToSettings(3))).toBe(
      false,
    );
    expect(canShowAvatarUrl(undefined, filehost, mediaLevelToSettings(3))).toBe(
      false,
    );
  });

  test("level 0 blocks all URLs", () => {
    expect(
      canShowAvatarUrl(`${filehost}/a.png`, filehost, mediaLevelToSettings(0)),
    ).toBe(false);
  });

  test("level 1 allows filehost URL", () => {
    expect(
      canShowAvatarUrl(`${filehost}/a.png`, filehost, mediaLevelToSettings(1)),
    ).toBe(true);
  });

  test("level 1 blocks arbitrary external URL", () => {
    expect(
      canShowAvatarUrl(
        "https://evil.com/track.png",
        filehost,
        mediaLevelToSettings(1),
      ),
    ).toBe(false);
  });

  test("level 2 allows URL from known embed domain", () => {
    expect(
      canShowAvatarUrl(
        "https://i.imgur.com/avatar.jpg",
        filehost,
        mediaLevelToSettings(2),
      ),
    ).toBe(true);
  });

  // Regression: prior implementation treated `showTrustedSourcesMedia` as
  // unconditional permission, admitting any HTTPS host at level 2.
  test("level 2 blocks arbitrary external URL", () => {
    expect(
      canShowAvatarUrl(
        "https://evil.com/track.png",
        filehost,
        mediaLevelToSettings(2),
      ),
    ).toBe(false);
  });

  test("level 3 allows arbitrary external URL", () => {
    expect(
      canShowAvatarUrl(
        "https://anywhere.example.com/a.png",
        filehost,
        mediaLevelToSettings(3),
      ),
    ).toBe(true);
  });

  // Browsers normalize scheme case and strip leading whitespace before fetching.
  test.each([
    ["HTTPS://evil.com/x.png"],
    [" \thttps://evil.com/x.png"],
  ])("level 1 blocks normalized-but-untrusted URL %s", (url) => {
    expect(canShowAvatarUrl(url, filehost, mediaLevelToSettings(1))).toBe(
      false,
    );
  });
});

describe("TRUSTED_EMBED_DOMAINS", () => {
  test("contains youtube.com as embed", () => {
    expect(TRUSTED_EMBED_DOMAINS["youtube.com"]).toBe("embed");
  });
  test("contains vimeo.com as embed", () => {
    expect(TRUSTED_EMBED_DOMAINS["vimeo.com"]).toBe("embed");
  });
  test("contains tenor.com as image", () => {
    expect(TRUSTED_EMBED_DOMAINS["tenor.com"]).toBe("image");
  });
  test("contains giphy.com as image", () => {
    expect(TRUSTED_EMBED_DOMAINS["giphy.com"]).toBe("image");
  });
});

describe("getEmbedThumbnailUrl", () => {
  test("returns YouTube thumbnail for standard URL", () => {
    expect(getEmbedThumbnailUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });
  test("returns YouTube thumbnail for youtu.be short URL", () => {
    expect(getEmbedThumbnailUrl("https://youtu.be/abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });
  test("returns YouTube thumbnail for /embed/ URL", () => {
    expect(getEmbedThumbnailUrl("https://www.youtube.com/embed/abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });
  test("returns YouTube thumbnail for /shorts/ URL", () => {
    expect(getEmbedThumbnailUrl("https://www.youtube.com/shorts/abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });
  test("returns null for non-YouTube URL", () => {
    expect(getEmbedThumbnailUrl("https://vimeo.com/123456")).toBeNull();
  });
  test("returns null for invalid URL", () => {
    expect(getEmbedThumbnailUrl("not-a-url")).toBeNull();
  });
});

describe("imageCanHaveTransparency", () => {
  test("returns false for .jpg URLs", () => {
    expect(imageCanHaveTransparency("https://example.com/photo.jpg")).toBe(
      false,
    );
  });
  test("returns false for .jpeg URLs", () => {
    expect(imageCanHaveTransparency("https://example.com/photo.jpeg")).toBe(
      false,
    );
  });
  test("returns false for .pdf URLs", () => {
    expect(imageCanHaveTransparency("https://example.com/doc.pdf")).toBe(false);
  });
  test("returns false for .pdf URLs with query strings", () => {
    expect(
      imageCanHaveTransparency("https://example.com/doc.pdf?token=abc"),
    ).toBe(false);
  });
  test("returns true for .png URLs (can have alpha)", () => {
    expect(imageCanHaveTransparency("https://example.com/image.png")).toBe(
      true,
    );
  });
  test("returns true for .gif URLs", () => {
    expect(imageCanHaveTransparency("https://example.com/anim.gif")).toBe(true);
  });
  test("returns true for .webp URLs", () => {
    expect(imageCanHaveTransparency("https://example.com/image.webp")).toBe(
      true,
    );
  });
  test("returns false for unknown extension (no checkerboard on filehost images)", () => {
    expect(imageCanHaveTransparency("https://example.com/file")).toBe(false);
  });
});
