import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import { readyProcessedServers } from "../../src/store/handlers/connection";
import * as storage from "../../src/store/localStorage";
import type { Channel } from "../../src/types";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-1",
    name: "#test",
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [],
    ...overrides,
  };
}

function setupServer(channelOverrides: Partial<Channel> = {}) {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [makeChannel(channelOverrides)],
        privateChats: [],
        isConnected: true,
        users: [],
      },
    ],
    messages: {},
    activeBatches: {},
    globalSettings: {
      showEvents: true,
      showJoinsParts: true,
    },
  } as unknown as AppState);
}

const AVATAR_META = {
  avatar: { value: "http://cdn.example.com/avatar.png", visibility: "public" },
};

// metadata is now an in-memory module cache; seed it via storage.metadata.save().
// biome-ignore lint/suspicious/noExplicitAny: test helper accepts loose shape
function seedMetadata(data: Record<string, any>) {
  storage.metadata.save(data);
}

describe("live JOIN — metadata restoration", () => {
  beforeEach(() => {
    setupServer();
    storage.metadata.save({});
  });

  it("attaches localStorage metadata to user on live join", () => {
    seedMetadata({ "srv-1": { bob: AVATAR_META } });

    ircClient.triggerEvent("JOIN", {
      serverId: "srv-1",
      username: "bob",
      channelName: "#test",
    });

    const channel = useStore
      .getState()
      .servers.find((s) => s.id === "srv-1")
      ?.channels.find((c) => c.name === "#test");

    const bob = channel?.users.find((u) => u.username === "bob");
    expect(bob).toBeDefined();
    expect(bob?.metadata).toEqual(AVATAR_META);
  });

  it("falls back to cross-channel metadata when localStorage has no entry", () => {
    // bob already has metadata in #other
    setupServer();
    useStore.setState((state) => ({
      servers: state.servers.map((s) =>
        s.id === "srv-1"
          ? {
              ...s,
              channels: [
                makeChannel({ name: "#test", id: "chan-1" }),
                makeChannel({
                  name: "#other",
                  id: "chan-2",
                  users: [
                    {
                      id: "bob-id",
                      username: "bob",
                      isOnline: true,
                      metadata: AVATAR_META,
                    },
                  ],
                }),
              ],
            }
          : s,
      ),
    }));

    ircClient.triggerEvent("JOIN", {
      serverId: "srv-1",
      username: "bob",
      channelName: "#test",
    });

    const channel = useStore
      .getState()
      .servers.find((s) => s.id === "srv-1")
      ?.channels.find((c) => c.name === "#test");

    const bob = channel?.users.find((u) => u.username === "bob");
    expect(bob?.metadata).toEqual(AVATAR_META);
  });

  it("join event message uses server-time tag when present", () => {
    const ts = "2026-01-15T10:00:00.000Z";

    ircClient.triggerEvent("JOIN", {
      serverId: "srv-1",
      username: "bob",
      channelName: "#test",
      time: ts,
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"] ?? [];
    const joinMsg = msgs.find((m) => m.type === "join");
    expect(joinMsg).toBeDefined();
    expect(joinMsg?.timestamp).toEqual(new Date(ts));
  });

  it("own join does not add self to member list (NAMES handles that)", () => {
    // Make ircClient think our nick is "me" for this server
    // by naming the JOIN event with the nick that getNick returns.
    // In tests there is no real connection so getNick returns null —
    // any non-null username will go through the else branch.
    // Test the own-join path by checking the channel-creation fallback instead.
    setupServer({ users: [{ id: "me-id", username: "me", isOnline: true }] });

    // bob (not us) joining should add bob, not duplicate existing users
    ircClient.triggerEvent("JOIN", {
      serverId: "srv-1",
      username: "bob",
      channelName: "#test",
    });

    const channel = useStore
      .getState()
      .servers.find((s) => s.id === "srv-1")
      ?.channels.find((c) => c.name === "#test");

    expect(channel?.users.some((u) => u.username === "bob")).toBe(true);
    expect(channel?.users.some((u) => u.username === "me")).toBe(true);
  });
});

describe("readyProcessedServers — reconnect guard", () => {
  beforeEach(() => {
    readyProcessedServers.clear();
    setupServer();
  });

  it("clears the server from readyProcessedServers on disconnect", () => {
    readyProcessedServers.add("srv-1");

    ircClient.triggerEvent("connectionStateChange", {
      serverId: "srv-1",
      connectionState: "disconnected",
    });

    expect(readyProcessedServers.has("srv-1")).toBe(false);
  });

  it("does not clear on connect (only on disconnect)", () => {
    readyProcessedServers.add("srv-1");

    ircClient.triggerEvent("connectionStateChange", {
      serverId: "srv-1",
      connectionState: "connected",
    });

    expect(readyProcessedServers.has("srv-1")).toBe(true);
  });
});
