import { describe, expect, test } from "vitest";
import {
  decodeBotToolsValue,
  encodeBotToolsValue,
  escapeIrcTagValue,
} from "../../src/lib/botTools";

// Tag values are base64 of compact JSON; wrap test inputs the same way a bot
// would on the wire.
const b64 = (o: unknown): string =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64");

describe("decodeBotToolsValue", () => {
  test("parses a workflow start message with features", () => {
    const got = decodeBotToolsValue(
      b64({
        msg: "workflow",
        id: "7f3a9b",
        state: "start",
        name: "Research",
        trigger: "m0042",
        features: ["interactive", "reasoning"],
      }),
    );
    expect(got).toEqual({
      msg: "workflow",
      id: "7f3a9b",
      state: "start",
      name: "Research",
      trigger: "m0042",
      features: ["interactive", "reasoning"],
    });
  });

  test("parses a step with nested-object tool-call content", () => {
    const got = decodeBotToolsValue(
      b64({
        msg: "step",
        wid: "7f3a9b",
        sid: "s2",
        type: "tool-call",
        state: "start",
        tool: "web-search",
        content: { query: "foo" },
      }),
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

  test("parses a reasoning step", () => {
    const got = decodeBotToolsValue(
      b64({
        msg: "step",
        wid: "w",
        sid: "s1",
        type: "reasoning",
        state: "complete",
        content: "planning the search",
      }),
    );
    expect(got).toMatchObject({
      type: "reasoning",
      content: "planning the search",
    });
  });

  test("parses an action input message", () => {
    const got = decodeBotToolsValue(
      b64({
        msg: "action",
        action: "input",
        target: "7f3a9b",
        content: "use the staging server",
      }),
    );
    expect(got).toEqual({
      msg: "action",
      action: "input",
      target: "7f3a9b",
      content: "use the staging server",
    });
  });

  test("returns null on malformed input", () => {
    expect(decodeBotToolsValue("not-valid-base64-!@#")).toBeNull();
  });

  test("returns null on unknown msg discriminator", () => {
    expect(decodeBotToolsValue(b64({ msg: "frob", x: 1 }))).toBeNull();
  });

  test("returns null on missing required fields", () => {
    expect(decodeBotToolsValue(b64({ msg: "workflow", id: "x" }))).toBeNull();
    expect(
      decodeBotToolsValue(b64({ msg: "step", wid: "x", sid: "y" })),
    ).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(decodeBotToolsValue("")).toBeNull();
  });

  test("preserves truncated flag and step cancelled-by", () => {
    const got = decodeBotToolsValue(
      b64({
        msg: "step",
        wid: "w",
        sid: "s",
        type: "tool-result",
        state: "cancelled",
        content: "part",
        truncated: true,
        "cancelled-by": "alice",
      }),
    );
    expect(got).toMatchObject({ truncated: true, "cancelled-by": "alice" });
  });
});

describe("encodeBotToolsValue", () => {
  test("emits base64 of compact JSON", () => {
    const out = encodeBotToolsValue({
      msg: "workflow",
      id: "x",
      state: "complete",
    });
    expect(out).toBe(
      Buffer.from(
        '{"msg":"workflow","id":"x","state":"complete"}',
        "utf8",
      ).toString("base64"),
    );
  });

  test("round-trips through decode", () => {
    const original = {
      msg: "step" as const,
      wid: "w",
      sid: "s",
      type: "tool-call" as const,
      state: "start" as const,
      tool: "web-search",
      content: { query: "héllo wörld" },
    };
    const re = decodeBotToolsValue(encodeBotToolsValue(original));
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
