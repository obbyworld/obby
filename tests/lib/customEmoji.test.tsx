import { act, renderHook, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEmojiPackCache,
  fetchEmojiPacks,
  renderWithCustomEmoji,
  useEmojiResolver,
} from "../../src/lib/customEmoji";

describe("customEmoji", () => {
  describe("renderWithCustomEmoji", () => {
    const renderText = (s: string, key: string) => <span key={key}>{s}</span>;

    it("returns the renderText output unchanged when no shortcodes match", () => {
      const out = renderWithCustomEmoji(
        "hello world",
        () => null,
        renderText,
        "k",
      );
      const html = renderToStaticMarkup(out);
      expect(html).toBe("<span>hello world</span>");
    });

    it("substitutes a single :shortcode: with an <img>", () => {
      const out = renderWithCustomEmoji(
        "hi :smile: there",
        (sc) => (sc === "smile" ? { url: "https://x/y.png" } : null),
        renderText,
        "k",
      );
      const html = renderToStaticMarkup(out);
      expect(html).toContain('src="https://x/y.png"');
      expect(html).toContain('alt=":smile:"');
      expect(html).toContain("<span>hi </span>");
      expect(html).toContain("<span> there</span>");
    });

    it("leaves unknown :shortcodes: as plain text", () => {
      const out = renderWithCustomEmoji(
        "hi :nope: there",
        () => null,
        renderText,
        "k",
      );
      const html = renderToStaticMarkup(out);
      expect(html).toBe("<span>hi :nope: there</span>");
      expect(html).not.toContain("<img");
    });

    it("uses provided alt text when present", () => {
      const out = renderWithCustomEmoji(
        ":party:",
        () => ({ url: "u", alt: "Party!" }),
        renderText,
        "k",
      );
      const html = renderToStaticMarkup(out);
      expect(html).toContain('alt="Party!"');
    });

    it("substitutes multiple shortcodes in one string", () => {
      const out = renderWithCustomEmoji(
        "a :one: b :two: c",
        (sc) => ({ url: `https://x/${sc}.png` }),
        renderText,
        "k",
      );
      const html = renderToStaticMarkup(out);
      expect(html).toContain("https://x/one.png");
      expect(html).toContain("https://x/two.png");
    });
  });

  describe("fetchEmojiPacks", () => {
    beforeEach(() => {
      clearEmojiPackCache();
    });
    afterEach(() => {
      vi.restoreAllMocks();
      clearEmojiPackCache();
    });

    it("dedupes concurrent fetches for the same URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [
          { id: "p", name: "P", emoji: { smile: { url: "u" } } },
        ],
      } as unknown as Response);

      const [a, b] = await Promise.all([
        fetchEmojiPacks("https://x/pack.json"),
        fetchEmojiPacks("https://x/pack.json"),
      ]);

      expect(a).toEqual(b);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null on HTTP error and caches the failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      const out = await fetchEmojiPacks("https://x/bad.json");
      expect(out).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call within TTL should not refetch
      await fetchEmojiPacks("https://x/bad.json");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null and caches on network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("net"));
      const out = await fetchEmojiPacks("https://x/err.json");
      expect(out).toBeNull();
    });
  });

  describe("useEmojiResolver trust gate", () => {
    const FILEHOST = "https://files.example.com";
    const TRUSTED_PACK = `${FILEHOST}/emoji/pack.json`;
    const UNTRUSTED_PACK = "https://evil.example/pack.json";
    const renderText = (s: string, key: string) => <span key={key}>{s}</span>;

    const mockPack = () =>
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "p",
            name: "P",
            emoji: {
              good: { url: `${FILEHOST}/emoji/good.png` },
              evil: { url: "https://evil.example/pixel.png" },
              inline: { url: "data:image/png;base64,AAAA" },
            },
          },
        ],
      } as unknown as Response);

    beforeEach(() => {
      clearEmojiPackCache();
    });
    afterEach(() => {
      vi.restoreAllMocks();
      clearEmojiPackCache();
    });

    it("never fetches a pack from an untrusted origin", async () => {
      const fetchSpy = mockPack();
      const { result } = renderHook(() =>
        useEmojiResolver([UNTRUSTED_PACK], [FILEHOST], 1),
      );
      await act(async () => {});

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.current.shortcodes).toEqual([]);
    });

    it("fetches a pack from the server filehost", async () => {
      const fetchSpy = mockPack();
      const { result } = renderHook(() =>
        useEmojiResolver([TRUSTED_PACK], [FILEHOST], 1),
      );
      await waitFor(() =>
        expect(result.current.resolve("good")).not.toBeNull(),
      );

      expect(fetchSpy).toHaveBeenCalledWith(TRUSTED_PACK, expect.anything());
      expect(result.current.resolve("inline")).not.toBeNull();
      expect(result.current.shortcodes.map((s) => s.shortcode)).toEqual([
        "good",
        "inline",
      ]);
    });

    it("renders an emoji from an untrusted image origin as its shortcode", async () => {
      mockPack();
      const { result } = renderHook(() =>
        useEmojiResolver([TRUSTED_PACK], [FILEHOST], 1),
      );
      await waitFor(() =>
        expect(result.current.resolve("good")).not.toBeNull(),
      );

      const html = renderToStaticMarkup(
        renderWithCustomEmoji(
          ":good: :evil:",
          result.current.resolve,
          renderText,
          "k",
        ),
      );
      expect(html).toContain(`src="${FILEHOST}/emoji/good.png"`);
      expect(html).not.toContain("evil.example");
      expect(html).toContain(":evil:");
    });

    it("fetches any pack once the reader shows all external content", async () => {
      const fetchSpy = mockPack();
      const { result } = renderHook(() =>
        useEmojiResolver([UNTRUSTED_PACK], [], 3),
      );
      await waitFor(() =>
        expect(result.current.resolve("evil")).not.toBeNull(),
      );

      expect(fetchSpy).toHaveBeenCalledWith(UNTRUSTED_PACK, expect.anything());
    });

    it("resolves a relative emoji URL against the pack URL", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "p",
          name: "P",
          emoji: { a: { url: "/uploads/emoji/a.png" } },
        }),
      } as unknown as Response);
      const { result } = renderHook(() =>
        useEmojiResolver(
          ["https://files.example.org/emoji/pack.json"],
          ["https://files.example.org"],
          1,
        ),
      );
      await waitFor(() => expect(result.current.resolve("a")).not.toBeNull());

      expect(result.current.resolve("a")?.url).toBe(
        "https://files.example.org/uploads/emoji/a.png",
      );
    });
  });
});
