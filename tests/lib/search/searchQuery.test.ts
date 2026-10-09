import { describe, expect, it } from "vitest";
import {
  appendSearchToken,
  filterTokenAt,
  formatDate,
  hasFilledToken,
  hasSearchToken,
  parseDate,
  parseSearchInput,
  serializeSearchQuery,
  toggleSearchToken,
  widenScope,
} from "../../../src/lib/search/searchQuery";
import type { SearchScope } from "../../../src/lib/search/searchTypes";

const chat: SearchScope = { kind: "chat", serverId: "s1", target: "#dev" };

describe("parseSearchInput", () => {
  it("lifts every filter out of the text", () => {
    const query = parseSearchInput(
      "deploy from:@alice mentions:me has:link after:2026-01-02 before:2026-02-03 failed",
      chat,
    );
    expect(query).toEqual({
      text: "deploy failed",
      scope: chat,
      from: "alice",
      aboutMe: true,
      hasLink: true,
      after: new Date(2026, 0, 2).getTime(),
      before: new Date(2026, 1, 3).getTime(),
    });
  });

  it("keeps tokens it cannot understand as words", () => {
    const query = parseSearchInput(
      "has:image mentions:you before:2026-13-01 in:#nowhere",
      chat,
    );
    expect(query.text).toBe(
      "has:image mentions:you before:2026-13-01 in:#nowhere",
    );
    expect(query.scope).toBe(chat);
  });

  it("moves the scope with a resolvable in:", () => {
    const network: SearchScope = { kind: "network", serverId: "s2" };
    const query = parseSearchInput("hi in:libera", chat, (value) =>
      value === "libera" ? network : null,
    );
    expect(query).toEqual({ text: "hi", scope: network });
  });
});

describe("serializeSearchQuery", () => {
  it("round-trips through the parser", () => {
    const input =
      "deploy from:alice mentions:me has:link after:2026-01-02 before:2026-02-03";
    expect(serializeSearchQuery(parseSearchInput(input, chat))).toBe(input);
  });
});

describe("helpers", () => {
  it("widens chat to network to everywhere", () => {
    expect(widenScope(chat)).toEqual({ kind: "network", serverId: "s1" });
    expect(widenScope({ kind: "network", serverId: "s1" })).toEqual({
      kind: "everywhere",
    });
  });

  it("parses and formats local dates", () => {
    expect(formatDate(parseDate("2026-03-09") ?? 0)).toBe("2026-03-09");
    expect(parseDate("2026-02-30")).toBeUndefined();
  });

  it("finds the filter word around the caret", () => {
    expect(filterTokenAt("hi from:al there", 10, ["from"])).toEqual({
      key: "from",
      value: "al",
      start: 3,
      end: 10,
    });
    expect(filterTokenAt("hi from:al", 2, ["from"])).toBeNull();
    expect(filterTokenAt("in:x", 4, ["from"])).toBeNull();
  });
});

describe("search tokens", () => {
  it("toggles a token on and back off, down to an empty text", () => {
    expect(toggleSearchToken("deploy", "has:link")).toBe("deploy has:link ");
    expect(toggleSearchToken("deploy has:link ", "has:link")).toBe("deploy");
    expect(toggleSearchToken("has:link ", "has:link")).toBe("");
  });

  it("appends a token after the existing words", () => {
    expect(appendSearchToken("deploy  ", "from:")).toBe("deploy from:");
    expect(appendSearchToken("", "from:")).toBe("from:");
  });

  it("tells a typed token from a filled prefix", () => {
    expect(hasSearchToken("a HAS:LINK", "has:link")).toBe(true);
    expect(hasFilledToken("from:", "from:")).toBe(false);
    expect(hasFilledToken("x from:bob", "from:")).toBe(true);
  });
});
