import { describe, expect, test, vi } from "vitest";
import {
  handleBouncer,
  handleBouncerFail,
} from "../../src/lib/irc/handlers/bouncer";
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
    sendRaw: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test helper accepts generic event payload
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

describe("BOUNCER protocol handler", () => {
  test("NETWORK with attrs emits a BOUNCER_NETWORK event with decoded attrs", () => {
    const ctx = makeCtx();
    handleBouncer(
      ctx,
      "s1",
      "irc.example",
      ["NETWORK", "42", "name=Freenode;state=connected"],
      undefined,
    );
    const ev = ctx.events.find((e) => e.event === "BOUNCER_NETWORK");
    expect(ev).toBeDefined();
    expect(ev?.data).toMatchObject({
      serverId: "s1",
      netid: "42",
      deleted: false,
      attributes: { name: "Freenode", state: "connected" },
    });
  });

  test("NETWORK with '*' as third param emits a deletion event", () => {
    const ctx = makeCtx();
    handleBouncer(ctx, "s1", "irc.example", ["NETWORK", "42", "*"], undefined);
    const ev = ctx.events.find((e) => e.event === "BOUNCER_NETWORK");
    expect(ev?.data).toMatchObject({
      serverId: "s1",
      netid: "42",
      deleted: true,
    });
  });

  test("ADDNETWORK / CHANGENETWORK / DELNETWORK acks emit their own events", () => {
    const ctx = makeCtx();
    handleBouncer(ctx, "s1", "", ["ADDNETWORK", "44"], undefined);
    handleBouncer(ctx, "s1", "", ["CHANGENETWORK", "44"], undefined);
    handleBouncer(ctx, "s1", "", ["DELNETWORK", "44"], undefined);
    expect(ctx.events.map((e) => e.event)).toEqual([
      "BOUNCER_ADDNETWORK_OK",
      "BOUNCER_CHANGENETWORK_OK",
      "BOUNCER_DELNETWORK_OK",
    ]);
  });

  test("subcommand match is case-insensitive", () => {
    const ctx = makeCtx();
    handleBouncer(ctx, "s1", "", ["network", "42", "name=Foo"], undefined);
    expect(ctx.events[0]?.event).toBe("BOUNCER_NETWORK");
  });

  test("batch tag from mtags is carried through to the event", () => {
    const ctx = makeCtx();
    handleBouncer(ctx, "s1", "", ["NETWORK", "42", "name=Foo"], {
      batch: "abc",
    });
    expect((ctx.events[0]?.data as { batchTag?: string }).batchTag).toBe("abc");
  });
});

describe("FAIL BOUNCER handler", () => {
  test("decodes INVALID_NETID into the netid field", () => {
    const ctx = makeCtx();
    handleBouncerFail(ctx, "s1", "", [
      "BOUNCER",
      "INVALID_NETID",
      "CHANGENETWORK",
      "999",
      "Network not found",
    ]);
    expect(ctx.events[0]?.data).toMatchObject({
      code: "INVALID_NETID",
      subcommand: "CHANGENETWORK",
      netid: "999",
      description: "Network not found",
    });
  });

  test("decodes INVALID_ATTRIBUTE into netid + attribute fields", () => {
    const ctx = makeCtx();
    handleBouncerFail(ctx, "s1", "", [
      "BOUNCER",
      "INVALID_ATTRIBUTE",
      "ADDNETWORK",
      "*",
      "port",
      "Invalid attribute value",
    ]);
    expect(ctx.events[0]?.data).toMatchObject({
      code: "INVALID_ATTRIBUTE",
      subcommand: "ADDNETWORK",
      netid: "*",
      attribute: "port",
    });
  });

  test("decodes NEED_ATTRIBUTE (no netid)", () => {
    const ctx = makeCtx();
    handleBouncerFail(ctx, "s1", "", [
      "BOUNCER",
      "NEED_ATTRIBUTE",
      "ADDNETWORK",
      "host",
      "Missing required attribute",
    ]);
    expect(ctx.events[0]?.data).toMatchObject({
      code: "NEED_ATTRIBUTE",
      subcommand: "ADDNETWORK",
      attribute: "host",
    });
  });

  test("propagates unknown codes verbatim", () => {
    const ctx = makeCtx();
    handleBouncerFail(ctx, "s1", "", [
      "BOUNCER",
      "WHATEVER_NEW",
      "LISTNETWORKS",
      "context-a",
      "context-b",
      "Some new failure",
    ]);
    expect(ctx.events[0]?.data).toMatchObject({
      code: "WHATEVER_NEW",
      subcommand: "LISTNETWORKS",
      context: ["context-a", "context-b"],
      description: "Some new failure",
    });
  });
});
