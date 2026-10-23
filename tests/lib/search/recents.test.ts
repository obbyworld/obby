import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecentSearches,
  clearRecents,
  getRecentPlaces,
  getRecentSearches,
  recordPlace,
  recordSearch,
} from "../../../src/lib/search/recents";

const everywhere = { kind: "everywhere" } as const;

describe("search recents", () => {
  // The global setup stubs localStorage with no-op spies, so we install a real one.
  beforeEach(() => {
    const data = new Map<string, string>();
    window.localStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    } as unknown as Storage;
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the newest search first without duplicates, capped at 10", () => {
    for (let i = 0; i < 12; i++)
      recordSearch({ text: `q${i}`, scope: everywhere });
    recordSearch({ text: "q5", scope: everywhere });
    const texts = getRecentSearches().map((q) => q.text);
    expect(texts).toHaveLength(10);
    expect(texts[0]).toBe("q5");
    expect(texts.filter((text) => text === "q5")).toHaveLength(1);
  });

  it("caps places at 8", () => {
    for (let i = 0; i < 10; i++)
      recordPlace({ serverId: "s", name: `#c${i}`, kind: "channel" });
    expect(getRecentPlaces()).toHaveLength(8);
    expect(getRecentPlaces()[0].name).toBe("#c9");
  });

  it("clears searches alone or every recent", () => {
    recordSearch({ text: "a", scope: everywhere });
    recordPlace({ serverId: "s", name: "#a", kind: "channel" });
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
    expect(getRecentPlaces()).toHaveLength(1);
    recordSearch({ text: "b", scope: everywhere });
    clearRecents();
    expect(getRecentSearches()).toEqual([]);
    expect(getRecentPlaces()).toEqual([]);
  });

  it("survives storage that throws or holds junk", () => {
    localStorage.setItem("obsidian.search.recentPlaces", "{nope");
    expect(getRecentPlaces()).toEqual([]);
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => recordSearch({ text: "x", scope: everywhere })).not.toThrow();
    expect(getRecentSearches()).toEqual([]);
  });
});
