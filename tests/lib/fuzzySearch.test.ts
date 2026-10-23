import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../../src/lib/fuzzySearch";

describe("fuzzyMatch", () => {
  it("ranks exact, prefix, word start and word pieces on one scale", () => {
    const exact = fuzzyMatch("calls", "Calls").score;
    const prefix = fuzzyMatch("show", "Show the MOTD").score;
    const wordStart = fuzzyMatch("motd", "Show the MOTD").score;
    const pieces = fuzzyMatch("shmo", "Show the MOTD").score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(pieces);
    expect(pieces).toBeGreaterThan(0);
  });

  it("refuses letters scattered inside a word", () => {
    expect(fuzzyMatch("hwt", "Show the MOTD").matches).toBe(false);
    expect(fuzzyMatch("alc", "alice").matches).toBe(false);
  });

  it("finds every word of a multi-word query at word starts", () => {
    const result = fuzzyMatch("motd show", "Show the MOTD");
    expect(result.matches).toBe(true);
    expect(result.ranges).toEqual([
      [9, 13],
      [0, 4],
    ]);
  });

  it("treats camel humps and separators as word starts", () => {
    expect(fuzzyMatch("nc", "nickChange").matches).toBe(true);
    expect(fuzzyMatch("snm", "void_snm").score).toBeGreaterThanOrEqual(70);
  });
});
