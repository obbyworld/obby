import { describe, expect, test } from "vitest";
import { classifyInbound } from "../../../src/lib/e2ee/classify";
import { E2EE_TAG } from "../../../src/lib/e2ee/protocol";

describe("classifyInbound — Obby by tag", () => {
  test("routes a message carrying the valueless flag tag to obby", () => {
    expect(classifyInbound({ mtags: { [E2EE_TAG]: "" } })).toEqual({
      scheme: "obby",
    });
  });

  test("routes a control TAGMSG whose tag value is the payload to obby", () => {
    expect(classifyInbound({ mtags: { [E2EE_TAG]: "eyJ0Ijoi" } })).toEqual({
      scheme: "obby",
    });
  });

  test("routes a message by its body marker even when the tag was stripped", () => {
    expect(classifyInbound({ body: "?obe2ee:eyJ0Ijoi" })).toEqual({
      scheme: "obby",
    });
  });

  test("a plaintext body is not obby just because the flag tag is attached", () => {
    expect(
      classifyInbound({ mtags: { [E2EE_TAG]: "" }, body: "hello there" }),
    ).toEqual({ scheme: "plaintext" });
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

  test("empty input is plaintext", () => {
    expect(classifyInbound({})).toEqual({ scheme: "plaintext" });
  });
});
