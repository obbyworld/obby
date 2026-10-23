import { describe, expect, test } from "vitest";
import {
  decodeBouncerAttrs,
  encodeBouncerAttrs,
  escapeBouncerValue,
  unescapeBouncerValue,
} from "../../src/lib/bouncerAttrs";

describe("bouncerAttrs", () => {
  describe("escape/unescape", () => {
    test("escapes the mtag-style sentinels", () => {
      expect(escapeBouncerValue("hello world")).toBe("hello\\sworld");
      expect(escapeBouncerValue("a;b")).toBe("a\\:b");
      expect(escapeBouncerValue("back\\slash")).toBe("back\\\\slash");
      expect(escapeBouncerValue("\r\n")).toBe("\\r\\n");
    });

    test("round-trip preserves arbitrary punctuation", () => {
      const samples = [
        "irc.example.com",
        "My Awesome Network",
        "a;b;c with spaces",
        "weird\\: characters",
        "newline\nin\nvalue",
        "",
      ];
      for (const s of samples) {
        expect(unescapeBouncerValue(escapeBouncerValue(s))).toBe(s);
      }
    });

    test("unknown escapes pass through the next char verbatim", () => {
      // \q isn't a defined escape; per the permissive mtag reading we
      // emit the q.
      expect(unescapeBouncerValue("a\\qb")).toBe("aqb");
    });
  });

  describe("encode/decode", () => {
    test("encodes Record<string,string> as semicolon-separated pairs", () => {
      expect(
        encodeBouncerAttrs({ name: "Foo", host: "irc.example", tls: "1" }),
      ).toBe("name=Foo;host=irc.example;tls=1");
    });

    test("escapes spaces and semicolons inside values", () => {
      expect(encodeBouncerAttrs({ name: "My Net; really" })).toBe(
        "name=My\\sNet\\:\\sreally",
      );
    });

    test("empty value renders as bare key (parser-friendly)", () => {
      expect(encodeBouncerAttrs({ pass: "" })).toBe("pass");
    });

    test("decode mirrors the soju doc example", () => {
      expect(
        decodeBouncerAttrs("name=My\\sAwesome\\sNetwork;state=disconnected"),
      ).toEqual({
        name: "My Awesome Network",
        state: "disconnected",
      });
    });

    test("decode treats a bare token as an empty-string value", () => {
      // Spec: in a notify update, attr=<empty> means deletion. We expose
      // that to the store as "" so handlers can decide.
      expect(decodeBouncerAttrs("error")).toEqual({ error: "" });
    });

    test("decode of '' is the empty record", () => {
      expect(decodeBouncerAttrs("")).toEqual({});
    });

    test("decode tolerates repeated semicolons", () => {
      expect(decodeBouncerAttrs("name=Foo;;tls=1")).toEqual({
        name: "Foo",
        tls: "1",
      });
    });
  });
});
