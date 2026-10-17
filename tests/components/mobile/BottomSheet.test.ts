import { describe, expect, it } from "vitest";
import { isDismissingSwipe } from "../../../src/components/mobile/BottomSheet";

describe("isDismissingSwipe", () => {
  it("closes after a third of the sheet, capped for tall sheets", () => {
    expect(isDismissingSwipe(70, 1000, 200)).toBe(true);
    expect(isDismissingSwipe(60, 1000, 300)).toBe(false);
    expect(isDismissingSwipe(130, 1000, 900)).toBe(true);
  });

  it("closes on a quick flick and ignores a twitch", () => {
    expect(isDismissingSwipe(50, 60, 600)).toBe(true);
    expect(isDismissingSwipe(20, 10, 600)).toBe(false);
  });
});
