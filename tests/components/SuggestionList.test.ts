import { describe, expect, it } from "vitest";
import { placeAboveComposer } from "../../src/components/ui/SuggestionList";

describe("placeAboveComposer", () => {
  it("spans the composer and stops below the header", () => {
    const style = placeAboveComposer(
      { top: 444, left: 0, right: 390 },
      { width: 390, height: 844 },
      48,
    );
    expect(style).toEqual({
      bottom: 406,
      left: 8,
      right: 8,
      maxHeight: 384,
    });
  });
});
