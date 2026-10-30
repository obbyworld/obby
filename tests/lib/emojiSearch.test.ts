import { describe, expect, it } from "vitest";
import { rankEmojis } from "../../src/lib/emojiSearch";

const emojis = [
  { short_names: ["control_knobs"], keywords: ["control", "knobs"] },
  { short_names: ["scroll"], keywords: ["paper"] },
  { short_names: ["face_with_rolling_eyes"], keywords: ["eyeroll", "ugh"] },
  { short_names: ["roller_coaster"], keywords: ["amusement_park"] },
  {
    short_names: ["hankey", "poop", "shit"],
    keywords: ["turd", "pile_of_poo"],
  },
  { short_names: ["+1", "thumbsup"], keywords: ["like"] },
  { short_names: ["100"], keywords: ["score"] },
];

const names = (query: string, limit = 10) =>
  rankEmojis(emojis, query, limit).map((e) => e.short_names[0]);

describe("rankEmojis", () => {
  it("puts word-start matches before substrings", () => {
    expect(names("rol")).toEqual([
      "roller_coaster",
      "face_with_rolling_eyes",
      "scroll",
      "control_knobs",
    ]);
  });

  it("finds an emoji by keyword", () => {
    expect(names("turd")).toEqual(["hankey"]);
    expect(names("of_poo")).toEqual(["hankey"]);
    expect(names("eyer")).toEqual(["face_with_rolling_eyes"]);
  });

  it("ranks an exact name first", () => {
    expect(names("poop")[0]).toBe("hankey");
    expect(names("100")).toEqual(["100"]);
  });

  it("matches symbols and ignores case", () => {
    expect(names("+1")).toEqual(["+1"]);
    expect(names("ROL")[0]).toBe("roller_coaster");
  });

  it("offers nothing for an empty query and respects the limit", () => {
    expect(names("")).toEqual([]);
    expect(names("rol", 2)).toEqual([
      "roller_coaster",
      "face_with_rolling_eyes",
    ]);
  });
});
