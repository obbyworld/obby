import { describe, expect, it } from "vitest";
import {
  argChoices,
  backspaceCancels,
  buildCommandPayload,
  coerceOptionValue,
  matchChoices,
  needsArguments,
  optionLabel,
} from "../../src/lib/commandInvocation";
import type { Channel, User } from "../../src/types";

const text = { name: "text", type: "string" as const };

describe("buildCommandPayload", () => {
  it("sends the trimmed text under the option name", () => {
    expect(buildCommandPayload([text], { text: "  hello there " })).toEqual({
      payload: { text: "hello there" },
    });
  });

  it("leaves empty optional options out", () => {
    expect(buildCommandPayload([text], { text: "" })).toEqual({ payload: {} });
  });

  it("refuses an empty required option", () => {
    expect(
      buildCommandPayload([{ ...text, required: true }], { text: " " }),
    ).toEqual({ error: { kind: "required", name: "text" } });
  });

  it("coerces numbers and rejects bad ones", () => {
    const opts = [
      { name: "n", type: "int" as const },
      { name: "f", type: "number" as const },
    ];
    expect(buildCommandPayload(opts, { n: "3", f: "1.5" })).toEqual({
      payload: { n: 3, f: 1.5 },
    });
    expect(buildCommandPayload(opts, { n: "3.2" })).toEqual({
      error: { kind: "int", name: "n" },
    });
    expect(buildCommandPayload(opts, { f: "x" })).toEqual({
      error: { kind: "number", name: "f" },
    });
  });
});

describe("coerceOptionValue", () => {
  it("reads whole numbers including zero and negatives", () => {
    expect(coerceOptionValue("int", "0")).toBe(0);
    expect(coerceOptionValue("int", "-7")).toBe(-7);
    expect(coerceOptionValue("int", "abc")).toBeUndefined();
    expect(coerceOptionValue("int", "1.5")).toBeUndefined();
  });

  it("rejects non-finite numbers", () => {
    expect(coerceOptionValue("number", "-0.5")).toBe(-0.5);
    expect(coerceOptionValue("number", "abc")).toBeUndefined();
    expect(coerceOptionValue("number", "Infinity")).toBeUndefined();
  });

  it("reads booleans case-insensitively", () => {
    for (const yes of ["true", "TRUE", "1", "Yes", "ON"])
      expect(coerceOptionValue("bool", yes)).toBe(true);
    for (const no of ["false", "0", "off", "nope"])
      expect(coerceOptionValue("bool", no)).toBe(false);
  });

  it("keeps text as typed", () => {
    expect(coerceOptionValue("string", "12")).toBe("12");
    expect(coerceOptionValue(undefined, "x")).toBe("x");
  });
});

describe("needsArguments", () => {
  it("is false for a command without options", () => {
    expect(needsArguments({ name: "ping" })).toBe(false);
    expect(needsArguments({ name: "ping", options: [] })).toBe(false);
    expect(needsArguments({ name: "agi", options: [text] })).toBe(true);
  });
});

describe("optionLabel", () => {
  it("marks optional options with a question mark", () => {
    expect(optionLabel({ name: "host", required: true })).toBe("host");
    expect(optionLabel({ name: "count" })).toBe("count?");
  });
});

describe("argChoices", () => {
  const users = [{ username: "alice" }, { username: "bob" }] as User[];
  const channels = [{ name: "#dev" }, { name: "&ops" }] as Channel[];
  it("offers declared choices first, then members or channels by type", () => {
    expect(
      argChoices({ name: "r", choices: ["core"] }, users, channels),
    ).toEqual(["core"]);
    expect(argChoices({ name: "u", type: "user" }, users, channels)).toEqual([
      "alice",
      "bob",
    ]);
    expect(argChoices({ name: "c", type: "channel" }, users, channels)).toEqual(
      ["#dev", "&ops"],
    );
    expect(argChoices(text, users, channels)).toEqual([]);
  });
});

describe("matchChoices", () => {
  const repos = ["core", "core-testing", "extra"];
  it("filters case-insensitively by what is typed", () => {
    expect(matchChoices(repos, "")).toEqual(repos);
    expect(matchChoices(repos, "TEST")).toEqual(["core-testing"]);
  });

  it("offers nothing once the value names a choice", () => {
    expect(matchChoices(repos, "Core")).toEqual([]);
  });
});

describe("backspaceCancels", () => {
  it("cancels only on an empty argument with the caret at the start", () => {
    expect(backspaceCancels("", 0, 0)).toBe(true);
    expect(backspaceCancels("a", 0, 0)).toBe(false);
    expect(backspaceCancels("", 0, 1)).toBe(false);
  });
});
