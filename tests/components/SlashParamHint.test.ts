import { describe, expect, it } from "vitest";
import { getActiveParamContext } from "../../src/components/ui/SlashParamHint";

describe("getActiveParamContext", () => {
  it("returns null while typing the command name", () => {
    // cursor at end of "/fore"
    expect(getActiveParamContext("/fore", 5)).toBeNull();
  });

  it("returns null for a literal '/' escape", () => {
    expect(getActiveParamContext("//forecast lon", 14)).toBeNull();
  });

  it("returns argIndex 0 right after the first space", () => {
    // "/forecast " cursor at end (10)
    expect(getActiveParamContext("/forecast ", 10)).toEqual({
      cmdName: "forecast",
      argIndex: 0,
    });
  });

  it("tracks subsequent argument positions", () => {
    // "/cmd a b c" with cursor inside the third arg
    const input = "/cmd a b c";
    expect(getActiveParamContext(input, input.length)).toEqual({
      cmdName: "cmd",
      argIndex: 2,
    });
  });

  it("keeps @botnick targeting in cmdName for composite lookup", () => {
    // Caller (SlashParamHint) looks up `forecast@weather` first against
    // the schemas map and falls back to the bare `forecast` on miss --
    // letting two bots disambiguate their hint without a shared map key.
    expect(getActiveParamContext("/forecast@weather london", 24)).toEqual({
      cmdName: "forecast@weather",
      argIndex: 0,
    });
  });

  it("is case-insensitive on the cmd name", () => {
    expect(getActiveParamContext("/Forecast london", 16)).toEqual({
      cmdName: "forecast",
      argIndex: 0,
    });
  });
});
