import { describe, expect, it } from "vitest";
import {
  matchesTerms,
  mentionsNick,
  queryTermsOf,
  searchFieldsOf,
  termsOf,
} from "../../../src/lib/history/searchFields";

describe("searchFieldsOf", () => {
  it("reads sender, plain text, own tag and reply from a single line", () => {
    expect(
      searchFieldsOf(
        "@msgid=m1;+draft/reply=p1;obby-own=1 :Alice!u@h PRIVMSG #c :\x02bold\x02 \x0304red\x03 see https://x.y",
      ),
    ).toEqual({
      nick: "Alice",
      text: "bold red see https://x.y",
      hasLink: true,
      isOwn: true,
      replyTo: "p1",
    });
  });

  it("accepts the unprefixed reply tag and lines without tags", () => {
    expect(searchFieldsOf("@+reply=p2 :bob!u@h PRIVMSG #c :hi").replyTo).toBe(
      "p2",
    );
    expect(searchFieldsOf(":bob!u@h PRIVMSG #c :hi")).toEqual({
      nick: "bob",
      text: "hi",
      hasLink: false,
      isOwn: false,
    });
  });

  it("unwraps a CTCP ACTION", () => {
    expect(
      searchFieldsOf(":bob!u@h PRIVMSG #c :\x01ACTION waves\x01").text,
    ).toBe("waves");
  });

  it("joins multiline lines with newlines and concat lines directly", () => {
    const raw = [
      "@msgid=M1;obby-own=1 :Alice!u@h BATCH +ml draft/multiline #c",
      "@batch=ml :Alice!u@h PRIVMSG #c :hello ",
      "@batch=ml;draft/multiline-concat :Alice!u@h PRIVMSG #c :world",
      "@batch=ml :Alice!u@h PRIVMSG #c :second",
      ":Alice!u@h BATCH -ml",
    ].join("\r\n");
    expect(searchFieldsOf(raw)).toMatchObject({
      nick: "Alice",
      text: "hello world\nsecond",
      isOwn: true,
    });
  });
});

describe("termsOf", () => {
  it("lowercases, splits on non letters, dedupes and cuts long words to 32 chars", () => {
    expect(
      termsOf(`Hello, hello! a ünïcode 日本語 x2 ${"z".repeat(33)}`),
    ).toEqual(["hello", "ünïcode", "日本語", "x2", "z".repeat(32)]);
  });
});

describe("queryTermsOf and matchesTerms", () => {
  it("needs every word and lets the last one be a prefix", () => {
    const query = queryTermsOf("Deploy fri");
    expect(query).toEqual({ exact: ["deploy"], prefix: "fri" });
    expect(matchesTerms("we deploy on friday", query)).toBe(true);
    expect(matchesTerms("deploy monday", query)).toBe(false);
    expect(matchesTerms("friday", query)).toBe(false);
  });

  it("checks long words in full", () => {
    const sha = "a".repeat(32);
    expect(matchesTerms(`${sha}b`, queryTermsOf(`${sha}c`))).toBe(false);
    expect(matchesTerms(`${sha}c x`, queryTermsOf(`${sha}c x`))).toBe(true);
    expect(matchesTerms(`${sha}b x`, queryTermsOf(`${sha}c x`))).toBe(false);
  });

  it("matches everything for empty text", () => {
    expect(matchesTerms("anything", queryTermsOf("  "))).toBe(true);
  });
});

describe("mentionsNick", () => {
  it.each([
    ["tester: hi", true],
    ["hi tester, how", true],
    ["ping @Tester", true],
    ["tester", true],
    ["testers rule", false],
    ["mytester", false],
    ["tester_ is away", false],
  ])("%s -> %s", (text, expected) => {
    expect(mentionsNick(text, "tester")).toBe(expected);
  });

  it("handles nicks with regex characters", () => {
    expect(mentionsNick("hey [x]|y:", "[x]|y")).toBe(true);
    expect(mentionsNick("hey a[x]|y", "[x]|y")).toBe(false);
  });
});
