import { describe, expect, test } from "vitest";
import { findChannelMentions } from "../../src/lib/channelMentions";

const names = (text: string) =>
  findChannelMentions(text).map((mention) => mention.name);

describe("findChannelMentions", () => {
  test("finds each channel prefix", () => {
    expect(names("see #general and ^voice and $stream")).toEqual([
      "#general",
      "^voice",
      "$stream",
    ]);
  });

  test("finds a mention that starts the text", () => {
    expect(names("#general is the place")).toEqual(["#general"]);
  });

  test("leaves sentence punctuation out of the name", () => {
    expect(names("come to #general.")).toEqual(["#general"]);
    expect(names("is it #general?")).toEqual(["#general"]);
    expect(names("(#general)")).toEqual(["#general"]);
  });

  test("finds two mentions in a row", () => {
    expect(names("#one #two")).toEqual(["#one", "#two"]);
  });

  // A fragment identifier is the most common false positive, and the reason a
  // mention has to start a word.
  test("ignores a fragment inside a URL", () => {
    expect(names("https://example.org/page#section")).toEqual([]);
  });

  test("ignores a prefix in the middle of a word", () => {
    expect(names("me#you")).toEqual([]);
  });

  test("ignores a bare prefix", () => {
    expect(names("costs # and $ and ^")).toEqual([]);
  });

  test("stops at a comma or a colon", () => {
    expect(names("#one,#two")).toEqual(["#one"]);
    expect(names("#general: hello")).toEqual(["#general"]);
  });

  test("reports offsets that slice the name back out", () => {
    const text = "join #general now";
    const [mention] = findChannelMentions(text);
    expect(text.slice(mention.start, mention.end)).toBe("#general");
  });

  test("finds nothing in text with no mention", () => {
    expect(names("just a normal sentence")).toEqual([]);
  });
});
