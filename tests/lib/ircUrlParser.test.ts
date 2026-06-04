import { describe, expect, it } from "vitest";
import {
  constructIrcUrl,
  isValidIrcUrl,
  normalizeChannelName,
  type ParsedIrcUrl,
  parseIrcUrl,
} from "../../src/lib/ircUrlParser";

describe("ircUrlParser", () => {
  describe("parseIrcUrl", () => {
    it("should parse basic IRC URL with default port", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/");

      expect(result).toEqual({
        host: "irc.libera.chat",
        port: 6667,
        scheme: "irc",
        channels: [],
        nick: "user",
        password: undefined,
      });
    });

    it("should parse IRCS URL with default port", () => {
      const result = parseIrcUrl("ircs://irc.libera.chat/");

      expect(result).toEqual({
        host: "irc.libera.chat",
        port: 6697,
        scheme: "ircs",
        channels: [],
        nick: "user",
        password: undefined,
      });
    });

    it("should parse URL with custom port", () => {
      const result = parseIrcUrl("ircs://irc.libera.chat:6697/");

      expect(result.port).toBe(6697);
    });

    it("should parse URL with single channel in pathname", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/channel1");

      expect(result.channels).toEqual(["#channel1"]);
    });

    it("should parse URL with multiple channels in pathname", () => {
      const result = parseIrcUrl(
        "irc://irc.libera.chat/channel1,channel2,channel3",
      );

      expect(result.channels).toEqual(["#channel1", "#channel2", "#channel3"]);
    });

    it("should parse URL with channels in hash", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/#channel1,channel2");

      expect(result.channels).toEqual(["#channel1", "#channel2"]);
    });

    it("should handle URL-encoded channel names", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/my%20channel");

      expect(result.channels).toEqual(["#my channel"]);
    });

    it("should parse URL with nick parameter", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/?nick=testuser");

      expect(result.nick).toBe("testuser");
    });

    it("should parse URL with password parameter", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/?password=secret123");

      expect(result.password).toBe("secret123");
    });

    it("should parse complex URL with all parameters", () => {
      const result = parseIrcUrl(
        "ircs://irc.libera.chat:6697/channel1,channel2?nick=testuser&password=secret",
      );

      expect(result).toEqual({
        host: "irc.libera.chat",
        port: 6697,
        scheme: "ircs",
        channels: ["#channel1", "#channel2"],
        nick: "testuser",
        password: "secret",
      });
    });

    it("should use custom default nick when provided", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/", "customnick");

      expect(result.nick).toBe("customnick");
    });

    it("should override default nick with URL parameter", () => {
      const result = parseIrcUrl(
        "irc://irc.libera.chat/?nick=urlnick",
        "defaultnick",
      );

      expect(result.nick).toBe("urlnick");
    });

    it("should sanitize URLs with trailing punctuation", () => {
      const result = parseIrcUrl("irc://irc.libera.chat/channel1,channel2.");

      expect(result.channels).toEqual(["#channel1", "#channel2"]);
    });

    it("should handle various trailing punctuation marks", () => {
      const testCases = [
        "irc://irc.libera.chat/test)",
        "irc://irc.libera.chat/test,",
        "irc://irc.libera.chat/test.",
        "irc://irc.libera.chat/test;",
        "irc://irc.libera.chat/test:",
        "irc://irc.libera.chat/test).,;:",
      ];

      testCases.forEach((url) => {
        const result = parseIrcUrl(url);
        expect(result.channels).toEqual(["#test"]);
      });
    });

    it("should handle channels with various prefixes", () => {
      const result = parseIrcUrl(
        "irc://irc.libera.chat/#chan1,&chan2,+chan3,!chan4",
      );

      expect(result.channels).toEqual(["#chan1", "&chan2", "+chan3", "!chan4"]);
    });
  });

  describe("normalizeChannelName", () => {
    it("should add # prefix to channel without prefix", () => {
      expect(normalizeChannelName("channel")).toBe("#channel");
    });

    it("should preserve # prefix", () => {
      expect(normalizeChannelName("#channel")).toBe("#channel");
    });

    it("should preserve & prefix", () => {
      expect(normalizeChannelName("&channel")).toBe("&channel");
    });

    it("should preserve + prefix", () => {
      expect(normalizeChannelName("+channel")).toBe("+channel");
    });

    it("should preserve ! prefix", () => {
      expect(normalizeChannelName("!channel")).toBe("!channel");
    });

    it("should handle empty string", () => {
      expect(normalizeChannelName("")).toBe("#");
    });
  });

  describe("isValidIrcUrl", () => {
    it("should return true for valid IRC URLs", () => {
      expect(isValidIrcUrl("irc://irc.libera.chat/")).toBe(true);
      expect(isValidIrcUrl("ircs://irc.libera.chat:6697/")).toBe(true);
    });

    it("should return false for non-IRC URLs", () => {
      expect(isValidIrcUrl("http://example.com")).toBe(false);
      expect(isValidIrcUrl("https://example.com")).toBe(false);
      expect(isValidIrcUrl("ftp://example.com")).toBe(false);
    });

    it("should return false for invalid URLs", () => {
      expect(isValidIrcUrl("not-a-url")).toBe(false);
      expect(isValidIrcUrl("")).toBe(false);
      expect(isValidIrcUrl("irc://")).toBe(false);
    });
  });

  describe("constructIrcUrl", () => {
    it("should construct basic IRC URL", () => {
      const details: ParsedIrcUrl = {
        host: "irc.libera.chat",
        port: 8000,
        scheme: "irc",
        channels: [],
        nick: "testuser",
      };

      const result = constructIrcUrl(details);
      expect(result).toBe("irc://irc.libera.chat:8000/?nick=testuser");
    });

    it("should construct IRCS URL with channels", () => {
      const details: ParsedIrcUrl = {
        host: "irc.libera.chat",
        port: 6697,
        scheme: "ircs",
        channels: ["#channel1", "#channel2"],
        nick: "testuser",
        password: "secret",
      };

      const result = constructIrcUrl(details);
      expect(result).toBe(
        "ircs://irc.libera.chat:6697/channel1,channel2?nick=testuser&password=secret",
      );
    });

    it("should construct URL without optional parameters", () => {
      const details: ParsedIrcUrl = {
        host: "irc.libera.chat",
        port: 443,
        scheme: "ircs",
        channels: ["#test"],
      };

      const result = constructIrcUrl(details);
      expect(result).toBe("ircs://irc.libera.chat:443/test");
    });
  });

  describe("round-trip compatibility", () => {
    it("should parse and reconstruct URLs correctly", () => {
      const testCases = [
        {
          url: "irc://irc.libera.chat:6667/",
          expected: {
            host: "irc.libera.chat",
            port: 6667,
            scheme: "irc" as const,
            channels: [],
            nick: "user",
          },
        },
        {
          url: "ircs://irc.libera.chat:6697/channel1,channel2?nick=testuser",
          expected: {
            host: "irc.libera.chat",
            port: 6697,
            scheme: "ircs" as const,
            channels: ["#channel1", "#channel2"],
            nick: "testuser",
          },
        },
        {
          url: "irc://irc.freenode.net/?nick=testuser",
          expected: {
            host: "irc.freenode.net",
            port: 6667,
            scheme: "irc" as const,
            channels: [],
            nick: "testuser",
          },
        },
      ];

      testCases.forEach(({ url, expected }) => {
        const parsed = parseIrcUrl(url);

        expect(parsed.host).toBe(expected.host);
        expect(parsed.port).toBe(expected.port);
        expect(parsed.scheme).toBe(expected.scheme);
        expect(parsed.channels).toEqual(expected.channels);
        expect(parsed.nick).toBe(expected.nick);

        // Test reconstruction produces parseable URLs
        const reconstructed = constructIrcUrl(parsed);
        const reParsed = parseIrcUrl(reconstructed);

        expect(reParsed.host).toBe(parsed.host);
        expect(reParsed.port).toBe(parsed.port);
        expect(reParsed.scheme).toBe(parsed.scheme);
        expect(reParsed.channels).toEqual(parsed.channels);
        expect(reParsed.nick).toBe(parsed.nick);
      });
    });
  });
});
