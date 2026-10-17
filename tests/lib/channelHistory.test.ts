import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSelectionHistory,
  getSelectionHistory,
  recordSelection,
  resumeRecording,
  suspendRecording,
} from "../../src/lib/channelHistory";

describe("channelHistory", () => {
  beforeEach(() => {
    clearSelectionHistory();
  });

  it("returns an empty list for a server with no history", () => {
    expect(getSelectionHistory("srv-1")).toEqual([]);
  });

  it("puts the most recent selection first", () => {
    recordSelection("srv-1", "a");
    recordSelection("srv-1", "b");
    recordSelection("srv-1", "c");
    expect(getSelectionHistory("srv-1")).toEqual(["c", "b", "a"]);
  });

  it("moves a repeat visit to the front instead of duplicating it", () => {
    recordSelection("srv-1", "a");
    recordSelection("srv-1", "b");
    recordSelection("srv-1", "a");
    expect(getSelectionHistory("srv-1")).toEqual(["a", "b"]);
  });

  it("keeps each server's history separate", () => {
    recordSelection("srv-1", "a");
    recordSelection("srv-2", "z");
    expect(getSelectionHistory("srv-1")).toEqual(["a"]);
    expect(getSelectionHistory("srv-2")).toEqual(["z"]);
  });

  it("caps the list at 30 entries", () => {
    for (let i = 0; i < 35; i++) {
      recordSelection("srv-1", `id-${i}`);
    }
    const history = getSelectionHistory("srv-1");
    expect(history).toHaveLength(30);
    expect(history[0]).toBe("id-34");
    expect(history.at(-1)).toBe("id-5");
  });

  it("drops recordings made while suspended", () => {
    recordSelection("srv-1", "a");
    suspendRecording();
    recordSelection("srv-1", "b");
    expect(getSelectionHistory("srv-1")).toEqual(["a"]);
    resumeRecording();
    recordSelection("srv-1", "b");
    expect(getSelectionHistory("srv-1")).toEqual(["b", "a"]);
  });
});
