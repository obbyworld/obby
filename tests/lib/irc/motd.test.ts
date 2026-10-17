import { describe, expect, test, vi } from "vitest";
import {
  handleRplEndOfMotd,
  handleRplMotd,
  handleRplMotdStart,
} from "../../../src/lib/irc/handlers/connection";
import type { IRCClientContext } from "../../../src/lib/irc/IRCClientContext";

function makeCtx() {
  const triggerEvent = vi.fn();
  const ctx = {
    motdLines: new Map<string, string[]>(),
    triggerEvent,
  } as Partial<IRCClientContext> as IRCClientContext;
  return { ctx, triggerEvent };
}

describe("MOTD numerics", () => {
  test("collects the body lines and emits them once the MOTD ends", () => {
    const { ctx, triggerEvent } = makeCtx();
    handleRplMotdStart(ctx, "s1");
    handleRplMotd(ctx, "s1", "irc.example", ["me", "- Welcome to example"]);
    handleRplMotd(ctx, "s1", "irc.example", ["me", "-   ___  ascii"]);
    handleRplMotd(ctx, "s1", "irc.example", ["me", "-"]);
    handleRplEndOfMotd(ctx, "s1");

    expect(triggerEvent).toHaveBeenCalledWith("MOTD", {
      serverId: "s1",
      lines: ["Welcome to example", "  ___  ascii", ""],
    });
    expect(ctx.motdLines.has("s1")).toBe(false);
  });

  test("emits nothing for an end without any body", () => {
    const { ctx, triggerEvent } = makeCtx();
    handleRplEndOfMotd(ctx, "s1");
    expect(triggerEvent).not.toHaveBeenCalled();
  });

  test("keeps servers apart", () => {
    const { ctx, triggerEvent } = makeCtx();
    handleRplMotdStart(ctx, "a");
    handleRplMotdStart(ctx, "b");
    handleRplMotd(ctx, "a", "x", ["me", "- from a"]);
    handleRplMotd(ctx, "b", "y", ["me", "- from b"]);
    handleRplEndOfMotd(ctx, "a");
    expect(triggerEvent).toHaveBeenCalledWith("MOTD", {
      serverId: "a",
      lines: ["from a"],
    });
  });
});
