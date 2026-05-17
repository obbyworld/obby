import { describe, expect, it } from "vitest";
import { parseIsupport, parseIsupportTokens } from "../../src/lib/ircUtils";

describe("parseIsupportTokens", () => {
  it("parses plain set tokens", () => {
    expect(parseIsupportTokens("NETWORK=Example NICKLEN=30")).toEqual([
      { key: "NETWORK", op: "set", value: "Example" },
      { key: "NICKLEN", op: "set", value: "30" },
    ]);
  });

  it("parses flag-only tokens", () => {
    expect(parseIsupportTokens("EXCEPTS INVEX")).toEqual([
      { key: "EXCEPTS", op: "set", value: "" },
      { key: "INVEX", op: "set", value: "" },
    ]);
  });

  it("parses the v0.2 append form", () => {
    expect(parseIsupportTokens("KEY+=,qux,quux,corge")).toEqual([
      { key: "KEY", op: "append", value: ",qux,quux,corge" },
    ]);
  });

  it("parses the delete form", () => {
    expect(parseIsupportTokens("-FOO")).toEqual([
      { key: "FOO", op: "delete", value: "" },
    ]);
  });

  it("preserves the empty-value append (no-op per spec)", () => {
    expect(parseIsupportTokens("KEY+=")).toEqual([
      { key: "KEY", op: "append", value: "" },
    ]);
  });

  it("decodes \\x20 in values", () => {
    expect(parseIsupportTokens("KEY=a\\x20b")).toEqual([
      { key: "KEY", op: "set", value: "a b" },
    ]);
  });

  it("ignores extra spaces", () => {
    expect(parseIsupportTokens("  A=1   B=2  ")).toEqual([
      { key: "A", op: "set", value: "1" },
      { key: "B", op: "set", value: "2" },
    ]);
  });
});

describe("parseIsupport (flat compat)", () => {
  it("byte-wise concatenates append form within one line", () => {
    expect(parseIsupport("KEY=foo,bar KEY+=,qux,quux")).toEqual({
      KEY: "foo,bar,qux,quux",
    });
  });

  it("delete drops the key", () => {
    expect(parseIsupport("FOO=1 -FOO BAR=2")).toEqual({
      BAR: "2",
    });
  });

  it("append onto unset key yields the value alone", () => {
    expect(parseIsupport("KEY+=alone")).toEqual({
      KEY: "alone",
    });
  });
});
