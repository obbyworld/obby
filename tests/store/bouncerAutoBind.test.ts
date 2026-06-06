/** Auto-bind on BOUNCER_NETWORK / BATCH_END for each `state=connected` row. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";

const PARENT_ID = "p-1";

function seedParentBouncerAndStorage() {
  // Saved parent in localStorage so bouncerConnectNetwork can read its
  // credentials and proceed to ircClient.connect / setPendingBouncerBind.
  const savedParent = {
    id: PARENT_ID,
    name: "soju",
    host: "wss://soju.example",
    port: 6662,
    nickname: "alice",
    saslEnabled: true,
    saslAccountName: "alice",
    saslPassword: "secret",
    channels: [],
    isBouncerControl: true,
  };
  vi.mocked(window.localStorage.getItem).mockImplementation((k: string) =>
    k === "savedServers" ? JSON.stringify([savedParent]) : null,
  );

  useStore.setState({
    servers: [
      {
        id: PARENT_ID,
        name: "soju",
        host: "wss://soju.example",
        port: 6662,
        channels: [],
        privateChats: [],
        users: [],
        isConnected: true,
        connectionState: "connected" as const,
        isBouncerControl: true,
      },
    ],
    bouncers: {},
  } as unknown as Partial<AppState>);
}

describe("bouncer auto-bind on state=connected", () => {
  beforeEach(() => {
    seedParentBouncerAndStorage();
    vi.spyOn(ircClient, "connect").mockResolvedValue(undefined as never);
    vi.spyOn(ircClient, "setPendingBouncerBind").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (
      ircClient as unknown as { eventCallbacks: Record<string, unknown[]> }
    ).eventCallbacks = {};
    useStore.setState({ servers: [], bouncers: {} } as Partial<AppState>);
  });

  test("BOUNCER_NETWORK with state=connected triggers a wire bind for that netid", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: PARENT_ID,
      netid: "42",
      deleted: false,
      attributes: { name: "Libera", state: "connected" },
    });
    const bindSpy = ircClient.setPendingBouncerBind as ReturnType<typeof vi.fn>;
    expect(bindSpy).toHaveBeenCalled();
    const calls = bindSpy.mock.calls.filter((c) => c[1] === "42");
    expect(calls).toHaveLength(1);
  });

  test("BOUNCER_NETWORK with state=disconnected does NOT trigger a bind", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: PARENT_ID,
      netid: "42",
      deleted: false,
      attributes: { name: "Libera", state: "disconnected" },
    });
    expect(ircClient.setPendingBouncerBind).not.toHaveBeenCalled();
  });
});
