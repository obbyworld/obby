/**
 * Boot-time reconnect for bouncer parents and standalone servers.
 *
 * Previous behaviour pre-seeded child Server rows from localStorage and
 * dispatched their connects after each parent's `ready` event. That
 * raced soju's auth in some setups and surfaced as an "Authentication
 * required" loop (issue #120 follow-up). The new design treats the
 * bouncer's own `state=connected` set as the source of truth: parents
 * reconnect here, children come back via the bouncer reducer's
 * `autoBindConnectedNetworks` after LISTNETWORKS lands. These tests
 * pin the boot path to "parents only" so a regression to the racy
 * pre-seed shows up here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";

const PARENT_ID = "p-1";
const CHILD_ID = "c-1";

const lsBacking = new Map<string, string>();
function installLocalStorageBacking() {
  lsBacking.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (k: string) => lsBacking.get(k) ?? null,
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (k: string, v: string) => {
      lsBacking.set(k, v);
    },
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation((k: string) => {
    lsBacking.delete(k);
  });
}

function seedParentAndChild() {
  installLocalStorageBacking();
  lsBacking.set(
    "savedServers",
    JSON.stringify([
      {
        id: PARENT_ID,
        name: "soju",
        host: "wss://soju.example:6662/socket",
        port: 6662,
        nickname: "alice",
        saslEnabled: true,
        saslAccountName: "alice",
        saslPassword: "secret",
        channels: [],
        isBouncerControl: true,
      },
      {
        id: CHILD_ID,
        name: "Libera",
        host: "wss://soju.example:6662/socket",
        port: 6662,
        nickname: "alice",
        saslEnabled: true,
        saslAccountName: "alice",
        saslPassword: "secret",
        channels: [],
        bouncerServerId: PARENT_ID,
        bouncerNetid: "42",
        isBouncerControl: false,
      },
    ]),
  );
  useStore.setState({
    servers: [],
    hasConnectedToSavedServers: false,
  } as Partial<AppState>);
}

describe("connectToSavedServers reconnects parents but leaves children to autoBindConnectedNetworks", () => {
  beforeEach(() => {
    seedParentAndChild();
    vi.spyOn(ircClient, "connect").mockResolvedValue(undefined as never);
    vi.spyOn(ircClient, "setPendingBouncerBind");
    vi.spyOn(useStore.getState(), "connect").mockResolvedValue(
      undefined as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lsBacking.clear();
    (
      ircClient as unknown as { eventCallbacks: Record<string, unknown[]> }
    ).eventCallbacks = {};
    useStore.setState({
      servers: [],
      hasConnectedToSavedServers: false,
    } as Partial<AppState>);
  });

  test("dispatches the parent connect through the store action", async () => {
    await useStore.getState().connectToSavedServers();
    // Parent reconnect goes through the store-level `connect` (saslEnabled etc.)
    const parentCalls = (
      useStore.getState().connect as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(parentCalls.length).toBe(1);
  });

  test("does NOT pre-seed a child Server row", async () => {
    await useStore.getState().connectToSavedServers();
    const child = useStore.getState().servers.find((s) => s.id === CHILD_ID);
    expect(child).toBeUndefined();
  });

  test("does NOT dispatch any child connect, even after the parent emits ready", async () => {
    await useStore.getState().connectToSavedServers();
    ircClient.triggerEvent("ready", {
      serverId: PARENT_ID,
      serverName: "soju.example",
      nickname: "alice",
    });
    expect(ircClient.setPendingBouncerBind).not.toHaveBeenCalled();
    const directChildConnects = (
      ircClient.connect as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[c.length - 1] === CHILD_ID);
    expect(directChildConnects).toHaveLength(0);
  });
});
