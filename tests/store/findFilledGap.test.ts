import { describe, expect, it } from "vitest";
import type { HistoryGap } from "../../src/lib/history/historyDb";
import { findFilledGap } from "../../src/store/handlers/history";

const gap = (id: number, from = 10, to = 20): HistoryGap => ({
  id,
  server: "s1",
  target: "#a",
  from,
  to,
  lost: false,
});

describe("findFilledGap", () => {
  it("finds the gap a fill started from", () => {
    expect(findFilledGap([gap(1), gap(2, 30, 40)], gap(1))).toEqual(gap(1));
  });

  it("finds another copy of the stretch when its own copy was removed", () => {
    expect(findFilledGap([gap(7)], gap(1))).toEqual(gap(7));
  });

  it("finds nothing once the stretch is closed", () => {
    expect(findFilledGap([gap(2, 30, 40)], gap(1))).toBeUndefined();
  });
});
