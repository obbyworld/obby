import { describe, expect, test } from "vitest";
import { classifyInbound } from "../../../src/lib/e2ee/classify";
import { E2EE_TAG } from "../../../src/lib/e2ee/protocol";

describe("classifyInbound — Obby-native tag", () => {
  test("routes the e2ee tag to obby (kind comes from the decoded payload)", () => {
    expect(classifyInbound({ mtags: { [E2EE_TAG]: "x" } })).toEqual({
      scheme: "obby",
      tag: E2EE_TAG,
    });
  });

  test("matches even with an empty value (valueless tag)", () => {
    expect(classifyInbound({ mtags: { [E2EE_TAG]: "" } })).toEqual({
      scheme: "obby",
      tag: E2EE_TAG,
    });
  });
});

describe("classifyInbound — OTR bodies", () => {
  const cases: Array<[string, string]> = [
    ["?OTR:AAMD...", "data"],
    ["?OTR|abcd|ef01,1,2,piece,", "fragment"],
    ["?OTR,1,2,piece,", "fragment"],
    ["?OTR Error: malformed", "error"],
    ["?OTRv23?", "query"],
    ["?OTR?", "query"],
  ];
  for (const [body, kind] of cases) {
    test(`${body.slice(0, 12)} -> otr/${kind}`, () => {
      expect(classifyInbound({ body })).toEqual({ scheme: "otr", kind });
    });
  }
});

describe("classifyInbound — precedence and plaintext", () => {
  test("a client-only tag wins over an OTR-looking body", () => {
    expect(
      classifyInbound({ mtags: { [E2EE_TAG]: "x" }, body: "?OTR:zzz" }),
    ).toEqual({ scheme: "obby", tag: E2EE_TAG });
  });

  test("ordinary chat is plaintext", () => {
    expect(classifyInbound({ body: "hello there" })).toEqual({
      scheme: "plaintext",
    });
  });

  test("a message mentioning OTR mid-line is not OTR", () => {
    expect(classifyInbound({ body: "i use ?OTR sometimes" })).toEqual({
      scheme: "plaintext",
    });
  });

  test("empty input is plaintext", () => {
    expect(classifyInbound({})).toEqual({ scheme: "plaintext" });
  });
});
