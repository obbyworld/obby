import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createLibreTranslateAdapter,
  LibreTranslateAdapter,
} from "../../src/lib/translation/adapters";

function makeResponse(body: Record<string, unknown>, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LibreTranslateAdapter", () => {
  test("posts translation requests to /translate", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        translatedText: "hola mundo",
        detectedLanguage: { language: "en" },
      }),
    );

    const adapter = new LibreTranslateAdapter({
      endpoint: "https://translate.example.com/",
    });

    await expect(
      adapter.translate({
        text: "hello world",
        sourceLanguage: "en",
        targetLanguage: "es",
      }),
    ).resolves.toEqual({
      translatedText: "hola mundo",
      detectedLanguage: "en",
      provider: "libretranslate",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://translate.example.com/translate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  test("includes api key and html format when configured", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ translatedText: "hola" }),
    );

    const adapter = createLibreTranslateAdapter({
      endpoint: "https://translate.example.com",
      apiKey: "secret",
      format: "html",
    });

    await adapter.translate({
      text: "<b>hello</b>",
      sourceLanguage: "en",
      targetLanguage: "es",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://translate.example.com/translate",
      expect.objectContaining({
        body: JSON.stringify({
          q: "<b>hello</b>",
          source: "en",
          target: "es",
          format: "html",
          api_key: "secret",
        }),
      }),
    );
  });

  test("surfaces backend errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ error: "rate limited" }, false),
    );

    const adapter = new LibreTranslateAdapter({
      endpoint: "https://translate.example.com",
    });

    await expect(
      adapter.translate({
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "es",
      }),
    ).rejects.toThrow("rate limited");
  });

  test("fails when translatedText is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}));

    const adapter = new LibreTranslateAdapter({
      endpoint: "https://translate.example.com",
    });

    await expect(
      adapter.translate({
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "es",
      }),
    ).rejects.toThrow("LibreTranslate returned no translated text.");
  });
});
