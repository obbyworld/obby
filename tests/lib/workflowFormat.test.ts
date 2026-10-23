import { describe, expect, it } from "vitest";
import {
  indentPartialJson,
  parseStepContent,
  summarizeArguments,
} from "../../src/lib/workflowFormat";

describe("parseStepContent", () => {
  it("parses JSON text", () => {
    expect(parseStepContent('{"id":1}')).toMatchObject({
      kind: "json",
      value: { id: 1 },
    });
  });

  it("flags JSON text a bot cut short", () => {
    expect(parseStepContent('{"id":1,"params":{"a"')).toMatchObject({
      kind: "text",
      looksCut: true,
    });
  });

  it("keeps plain text as text", () => {
    expect(parseStepContent("done")).toEqual({
      kind: "text",
      text: "done",
      looksCut: false,
    });
  });
});

describe("indentPartialJson", () => {
  it("indents JSON that stops mid-value and leaves strings alone", () => {
    expect(indentPartialJson('{"a":1,"b":{"c":"x, {y}","d"')).toBe(
      '{\n  "a": 1,\n  "b": {\n    "c": "x, {y}",\n    "d"',
    );
  });
});

describe("summarizeArguments", () => {
  it("lists scalar fields and skips nested ones", () => {
    expect(summarizeArguments({ id: 99, hard: true, opts: { x: 1 } })).toBe(
      "id: 99 · hard: true",
    );
  });
});
