import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";
import type { Server, ServerConfig } from "../../src/types";
import {
  installLocalStorageBacking,
  lsBacking,
} from "../fixtures/localStorageBacking";

function savedServers(): ServerConfig[] {
  return JSON.parse(lsBacking.get("savedServers") ?? "[]");
}

function addServer(nickname: string, account?: string) {
  return useStore
    .getState()
    .connect(
      "h4ks",
      "wss://irc.example.com:443",
      443,
      nickname,
      !!account,
      undefined,
      account,
      account ? "secret" : undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
}

describe("adding servers on one network", () => {
  beforeEach(() => {
    installLocalStorageBacking();
    vi.spyOn(ircClient, "connect").mockImplementation(
      async (name, host, port, _nick, _pw, _acct, _saslPw, serverId) =>
        ({
          id: serverId ?? "unexpected",
          name,
          host,
          port,
          channels: [],
          privateChats: [],
          isConnected: true,
          connectionState: "connected",
          users: [],
        }) as Server,
    );
    useStore.setState({ servers: [] } as Partial<AppState>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useStore.setState({ servers: [] } as Partial<AppState>);
  });

  test("keeps a second account on the same address as its own server", async () => {
    await addServer("alice", "alice");
    await addServer("bob", "bob");

    expect(useStore.getState().servers).toHaveLength(2);
    expect(savedServers().map((s) => s.nickname)).toEqual(["alice", "bob"]);
  });

  test("opens the existing server when the same login is added again", async () => {
    const first = await addServer("alice", "alice");
    const again = await addServer("alice", "alice");

    expect(again.id).toBe(first.id);
    expect(useStore.getState().servers).toHaveLength(1);
    expect(savedServers()).toHaveLength(1);
  });
});
