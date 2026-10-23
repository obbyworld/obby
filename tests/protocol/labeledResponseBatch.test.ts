import { describe, expect, test, vi } from "vitest";
import {
  handleBatch,
  handlePrivmsg,
} from "../../src/lib/irc/handlers/messages";
import type { IRCClientContext } from "../../src/lib/irc/IRCClientContext";

type TestCtx = IRCClientContext & {
  events: Array<{ event: string; data: unknown }>;
};

function makeCtx(): TestCtx {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    nicks: new Map(),
    myIdents: new Map(),
    myHosts: new Map(),
    currentUsers: new Map(),
    servers: new Map(),
    pongTimeouts: new Map(),
    reconnectionTimeouts: new Map(),
    rateLimitedServers: new Map(),
    capNegotiationComplete: new Map(),
    activeBatches: new Map(),
    isupportValues: new Map(),
    sendRaw: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test helper needs generic signature
    triggerEvent(event: string, data: any) {
      events.push({ event, data });
    },
    isRateLimitError: vi.fn(() => false),
    startWebSocketPing: vi.fn(),
    userOnConnect: vi.fn(),
    onCapLs: vi.fn(),
    onCapAck: vi.fn(),
    onCapNew: vi.fn(),
    onCapDel: vi.fn(),
    events,
  } as unknown as TestCtx;
}

describe("labeled-response — batch label inheritance", () => {
  test("inner PRIVMSG inherits label from labeled-response BATCH opener", () => {
    const ctx = makeCtx();
    const label = "alice_label_42";

    handleBatch(ctx, "s1", ":irc.example", ["+abc", "labeled-response"], {
      label,
    });

    handlePrivmsg(ctx, "s1", ":alice!u@h", ["bob", "Hello, are you there?"], {
      batch: "abc",
      msgid: "m1",
      time: "2026-05-13T17:46:30.198Z",
    });

    const usermsg = ctx.events.find((e) => e.event === "USERMSG");
    expect(usermsg).toBeDefined();
    const mtags = (
      usermsg?.data as { mtags?: Record<string, string> } | undefined
    )?.mtags;
    expect(mtags?.label).toBe(label);
    expect(mtags?.batch).toBe("abc");
    expect(mtags?.msgid).toBe("m1");
  });

  test("inner CHANMSG inherits label from labeled-response BATCH opener", () => {
    const ctx = makeCtx();
    const label = "alice_chan_label";

    handleBatch(ctx, "s1", ":irc.example", ["+xyz", "labeled-response"], {
      label,
    });

    handlePrivmsg(ctx, "s1", ":alice!u@h", ["#chan", "hi everyone"], {
      batch: "xyz",
      msgid: "m2",
    });

    const chanmsg = ctx.events.find((e) => e.event === "CHANMSG");
    expect(chanmsg).toBeDefined();
    expect(
      (chanmsg?.data as { mtags?: Record<string, string> } | undefined)?.mtags
        ?.label,
    ).toBe(label);
  });

  test("PRIVMSG not inside a labeled-response batch keeps mtags untouched", () => {
    const ctx = makeCtx();

    handlePrivmsg(ctx, "s1", ":alice!u@h", ["bob", "plain message"], {
      msgid: "m3",
    });

    const usermsg = ctx.events.find((e) => e.event === "USERMSG");
    expect(
      (usermsg?.data as { mtags?: Record<string, string> } | undefined)?.mtags
        ?.label,
    ).toBeUndefined();
  });

  test("PRIVMSG inside a non-labeled-response batch does not gain a label", () => {
    const ctx = makeCtx();

    handleBatch(ctx, "s1", ":irc.example", ["+hist", "chathistory", "#chan"], {
      label: "should_not_propagate",
    });

    handlePrivmsg(ctx, "s1", ":alice!u@h", ["#chan", "history line"], {
      batch: "hist",
      msgid: "m4",
    });

    const chanmsg = ctx.events.find((e) => e.event === "CHANMSG");
    expect(
      (chanmsg?.data as { mtags?: Record<string, string> } | undefined)?.mtags
        ?.label,
    ).toBeUndefined();
  });

  test("an inner label tag takes precedence over the batch label", () => {
    const ctx = makeCtx();

    handleBatch(ctx, "s1", ":irc.example", ["+abc", "labeled-response"], {
      label: "batch_label",
    });

    handlePrivmsg(ctx, "s1", ":alice!u@h", ["bob", "explicit"], {
      batch: "abc",
      label: "explicit_label",
      msgid: "m5",
    });

    const usermsg = ctx.events.find((e) => e.event === "USERMSG");
    expect(
      (usermsg?.data as { mtags?: Record<string, string> } | undefined)?.mtags
        ?.label,
    ).toBe("explicit_label");
  });
});
