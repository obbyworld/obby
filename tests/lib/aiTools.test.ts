import { describe, expect, test } from "vitest";
import {
  decodeAiToolsValue,
  encodeAiToolsValue,
  escapeIrcTagValue,
} from "../../src/lib/aiTools";

describe("decodeAiToolsValue", () => {
  test("parses a workflow start message", () => {
    const got = decodeAiToolsValue(
      '{"msg":"workflow","id":"7f3a9b","state":"start","name":"Research","trigger":"m0042"}',
    );
    expect(got).toEqual({
      msg: "workflow",
      id: "7f3a9b",
      state: "start",
      name: "Research",
      trigger: "m0042",
    });
  });

  test("parses a step with nested-object tool-call content", () => {
    const got = decodeAiToolsValue(
      '{"msg":"step","wid":"7f3a9b","sid":"s2","type":"tool-call","state":"start","tool":"web-search","content":{"query":"foo"}}',
    );
    expect(got).toMatchObject({
      msg: "step",
      wid: "7f3a9b",
      sid: "s2",
      type: "tool-call",
      tool: "web-search",
      content: { query: "foo" },
    });
  });

  test("parses an action message", () => {
    const got = decodeAiToolsValue(
      '{"msg":"action","action":"cancel","target":"7f3a9b"}',
    );
    expect(got).toEqual({
      msg: "action",
      action: "cancel",
      target: "7f3a9b",
    });
  });

  test("returns null on malformed JSON", () => {
    expect(decodeAiToolsValue("not-json")).toBeNull();
  });

  test("returns null on unknown msg discriminator", () => {
    expect(decodeAiToolsValue('{"msg":"frob","x":1}')).toBeNull();
  });

  test("returns null on missing required fields", () => {
    expect(decodeAiToolsValue('{"msg":"workflow","id":"x"}')).toBeNull();
    expect(decodeAiToolsValue('{"msg":"step","wid":"x","sid":"y"}')).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(decodeAiToolsValue("")).toBeNull();
  });

  test("preserves truncated flag", () => {
    const got = decodeAiToolsValue(
      '{"msg":"step","wid":"w","sid":"s","type":"tool-result","state":"complete","content":"part","truncated":true}',
    );
    expect(got).toMatchObject({ truncated: true });
  });
});

describe("encodeAiToolsValue", () => {
  test("emits compact JSON, no whitespace", () => {
    const out = encodeAiToolsValue({
      msg: "workflow",
      id: "x",
      state: "complete",
    });
    expect(out).toBe('{"msg":"workflow","id":"x","state":"complete"}');
  });

  test("round-trips through decode", () => {
    const original = {
      msg: "step" as const,
      wid: "w",
      sid: "s",
      type: "tool-call" as const,
      state: "start" as const,
      tool: "web-search",
      content: { query: "hello world" },
    };
    const re = decodeAiToolsValue(encodeAiToolsValue(original));
    expect(re).toEqual(original);
  });
});

describe("escapeIrcTagValue", () => {
  test("escapes the five required chars per IRCv3", () => {
    expect(escapeIrcTagValue("a;b c\\d\re\nf")).toBe("a\\:b\\sc\\\\d\\re\\nf");
  });

  test("leaves ordinary text unchanged", () => {
    expect(escapeIrcTagValue("hello-world")).toBe("hello-world");
  });
});
