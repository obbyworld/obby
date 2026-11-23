import { describe, expect, it } from "vitest";
import { revealHiddenChars, stripHiddenChars } from "../../src/lib/hiddenChars";

const HIDDEN = [
  "\u0000",
  "\u001f",
  "\u007f",
  "\u009f",
  "\u{061c}",
  "\u{200e}",
  "\u{200f}",
  "\u{202a}",
  "\u{202e}",
  "\u{2066}",
  "\u{2069}",
];

describe("hiddenChars", () => {
  it.each(HIDDEN)("strips and reveals hidden character %#", (char) => {
    expect(stripHiddenChars(`a${char}b`)).toBe("ab");
    expect(revealHiddenChars(`a${char}b`)).toBe(
      `a${encodeURIComponent(char)}b`,
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "https://例え.jp/ünïcode?q=ä b#עברית";
    expect(stripHiddenChars(text)).toBe(text);
    expect(revealHiddenChars(text)).toBe(text);
  });
});
