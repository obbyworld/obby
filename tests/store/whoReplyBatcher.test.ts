import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreApi } from "zustand";
import {
  _peekWhoReplyBatcher,
  _resetWhoReplyBatcher,
  bufferWhoReply,
  flushWhoReplies,
} from "../../src/store/whoReplyBatcher";

function makeMockStore() {
  const setCalls: unknown[] = [];
  let state: {
    servers: Array<{
      id: string;
      channels: Array<{
        name: string;
        users: Array<{
          id: string;
          username: string;
          metadata: Record<string, unknown>;
          [k: string]: unknown;
        }>;
      }>;
      privateChats?: Array<{
        username: string;
        [k: string]: unknown;
      }>;
    }>;
  } = {
    servers: [
      {
        id: "s1",
        channels: [
          { name: "#room", users: [] },
          { name: "#other", users: [] },
        ],
        privateChats: [],
      },
    ],
  };
  return {
    setState: vi.fn((updater: unknown) => {
      setCalls.push(updater);
      if (typeof updater === "function") {
        const patch = (updater as (s: typeof state) => Partial<typeof state>)(
          state,
        );
        state = { ...state, ...patch };
      }
    }),
    getState: () => state,
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    subscribe: vi.fn() as any,
    setCalls,
    snapshot: () => state,
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
  } as unknown as StoreApi<any> & {
    setCalls: unknown[];
    snapshot: () => typeof state;
  };
}

describe("whoReplyBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetWhoReplyBatcher();
  });

  afterEach(() => {
    _resetWhoReplyBatcher();
    vi.useRealTimers();
  });

  test("coalesces N WHO replies into a single setState after idle", () => {
    const store = makeMockStore();
    for (let i = 0; i < 50; i++) {
      bufferWhoReply(store, "s1", "#room", {
        nick: `user${i}`,
        host: "h.example",
        realname: `Real ${i}`,
        status: "",
      });
    }
    expect(store.setState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59);
    expect(store.setState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(store.setState).toHaveBeenCalledTimes(1);
    const finalUsers = store.snapshot().servers[0].channels[0].users;
    expect(finalUsers).toHaveLength(50);
    expect(finalUsers[0].username).toBe("user0");
    expect(finalUsers[49].username).toBe("user49");
  });

  test("last-write-wins per nick within a single burst", () => {
    const store = makeMockStore();
    bufferWhoReply(store, "s1", "#room", {
      nick: "alice",
      realname: "first",
      host: "first.host",
    });
    bufferWhoReply(store, "s1", "#room", {
      nick: "alice",
      realname: "second",
      host: "second.host",
    });
    vi.advanceTimersByTime(70);
    const u = store.snapshot().servers[0].channels[0].users[0];
    expect(u.realname).toBe("second");
    expect(u.hostname).toBe("second.host");
  });

  test("explicit flushWhoReplies bypasses the idle wait (WHO_END path)", () => {
    const store = makeMockStore();
    bufferWhoReply(store, "s1", "#room", { nick: "bob" });
    expect(store.setState).not.toHaveBeenCalled();
    flushWhoReplies(store, "s1", "#room");
    expect(store.setState).toHaveBeenCalledTimes(1);
    expect(_peekWhoReplyBatcher("s1", "#room")).toBeUndefined();
  });

  test("a trickling WHO still flushes via the ceiling timer", () => {
    const store = makeMockStore();
    // Push a reply, then keep re-arming idle just under 60ms apart so
    // the idle timer NEVER fires. Ceiling at 1000ms should still flush.
    for (let i = 0; i < 30; i++) {
      bufferWhoReply(store, "s1", "#room", { nick: `slow${i}` });
      vi.advanceTimersByTime(30);
    }
    expect(store.setState).not.toHaveBeenCalled();
    // One more push to make the elapsed time exceed FLUSH_MAX_MS overall
    vi.advanceTimersByTime(200);
    expect(store.setState).toHaveBeenCalledTimes(1);
    const users = store.snapshot().servers[0].channels[0].users;
    expect(users).toHaveLength(30);
  });

  test("merges into existing users rather than appending duplicates", () => {
    const store = makeMockStore();
    // Seed: pretend alice was already in the user list from NAMES.
    const s = store.snapshot();
    s.servers[0].channels[0].users.push({
      id: "alice",
      username: "alice",
      metadata: {},
      realname: undefined,
      hostname: undefined,
    });
    bufferWhoReply(store, "s1", "#room", {
      nick: "alice",
      host: "h.example",
      realname: "Alice Cooper",
      isIrcOp: true,
    });
    vi.advanceTimersByTime(70);
    const users = store.snapshot().servers[0].channels[0].users;
    expect(users).toHaveLength(1);
    expect(users[0].realname).toBe("Alice Cooper");
    expect(users[0].isIrcOp).toBe(true);
    expect(users[0].hostname).toBe("h.example");
  });

  test("buckets are scoped per (serverId, channel)", () => {
    const store = makeMockStore();
    bufferWhoReply(store, "s1", "#room", { nick: "alice" });
    bufferWhoReply(store, "s1", "#other", { nick: "bob" });
    vi.advanceTimersByTime(70);
    // Two distinct setState calls (one per bucket), each in a separate
    // timer tick.
    expect(store.setState).toHaveBeenCalledTimes(2);
    const snap = store.snapshot();
    expect(snap.servers[0].channels[0].users[0].username).toBe("alice");
    expect(snap.servers[0].channels[1].users[0].username).toBe("bob");
  });
});
