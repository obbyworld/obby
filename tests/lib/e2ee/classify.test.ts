import { describe, expect, test } from "vitest";
import { classifyInbound } from "../../../src/lib/e2ee/classify";
import { E2EE_BODY_PREFIX } from "../../../src/lib/e2ee/protocol";

describe("classifyInbound — Obby-native body", () => {
  test("routes the Obby marker to obby (kind comes from the decoded payload)", () => {
    expect(classifyInbound({ body: `${E2EE_BODY_PREFIX}eyJ0Ijoi` })).toEqual({
      scheme: "obby",
    });
  });

  test("matches the bare marker even before any payload", () => {
    expect(classifyInbound({ body: E2EE_BODY_PREFIX })).toEqual({
      scheme: "obby",
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

describe("classifyInbound — plaintext", () => {
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

  test("a message mentioning the Obby marker mid-line is not Obby", () => {
    expect(classifyInbound({ body: `see ${E2EE_BODY_PREFIX}xx` })).toEqual({
      scheme: "plaintext",
    });
  });

  test("empty input is plaintext", () => {
    expect(classifyInbound({})).toEqual({ scheme: "plaintext" });
  });
});
