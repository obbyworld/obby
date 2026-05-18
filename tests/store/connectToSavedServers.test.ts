/**
 * Boot-time reconnect ordering for bouncer parents and their children.
 *
 * The previous behaviour fired parent + child reconnects in parallel,
 * which raced the children's SASL/BIND against the parent's not-yet-
 * authenticated session and surfaced as "invalid password" against
 * soju. The fix: dispatch each child only after its parent emits
 * `ready`. These tests pin that ordering down so a regression shows
 * up here, not in production.
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

describe("connectToSavedServers gates bouncer children on parent ready", () => {
  beforeEach(() => {
    seedParentAndChild();
    // Track ircClient.on/deleteHook so we can fire the `ready` event ourselves.
    vi.spyOn(ircClient, "connect").mockResolvedValue(undefined as never);
    vi.spyOn(ircClient, "setPendingBouncerBind");
    // Store-level connect for non-bouncer parents — also a no-op spy.
    vi.spyOn(useStore.getState(), "connect").mockResolvedValue(
      undefined as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lsBacking.clear();
    // Drop every listener the test registered. The store under test
    // attaches a `ready` listener to ircClient that survives across
    // tests if we don't clear it -- multiple stacked listeners would
    // dispatch the same child connect more than once.
    (
      ircClient as unknown as { eventCallbacks: Record<string, unknown[]> }
    ).eventCallbacks = {};
    useStore.setState({
      servers: [],
      hasConnectedToSavedServers: false,
    } as Partial<AppState>);
  });

  test("seeds child Server immediately so the UI shows a row from t=0", async () => {
    await useStore.getState().connectToSavedServers();
    const child = useStore.getState().servers.find((s) => s.id === CHILD_ID);
    expect(child).toBeDefined();
    expect(child?.bouncerServerId).toBe(PARENT_ID);
    expect(child?.bouncerNetid).toBe("42");
    expect(child?.connectionState).toBe("connecting");
  });

  test("does NOT dispatch the child connect before parent emits ready", async () => {
    await useStore.getState().connectToSavedServers();
    // The parent's connect happened (store-level); the child should not have
    // its own WS yet.
    const ircConnectCalls = (
      ircClient.connect as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[c.length - 1] === CHILD_ID);
    expect(ircConnectCalls).toHaveLength(0);
    expect(ircClient.setPendingBouncerBind).not.toHaveBeenCalled();
  });

  test("dispatches the child connect once the parent's ready event fires", async () => {
    await useStore.getState().connectToSavedServers();
    // Fire ready for the parent — the deferred-child listener should
    // pick it up and call ircClient.connect with the child id.
    ircClient.triggerEvent("ready", {
      serverId: PARENT_ID,
      serverName: "soju.example",
      nickname: "alice",
    });
    expect(ircClient.setPendingBouncerBind).toHaveBeenCalledWith(
      CHILD_ID,
      "42",
    );
    const callsForChild = (
      ircClient.connect as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[c.length - 1] === CHILD_ID);
    expect(callsForChild).toHaveLength(1);
  });

  test("ignores ready events from unrelated servers", async () => {
    await useStore.getState().connectToSavedServers();
    ircClient.triggerEvent("ready", {
      serverId: "some-other-server",
      serverName: "irrelevant",
      nickname: "alice",
    });
    expect(ircClient.setPendingBouncerBind).not.toHaveBeenCalled();
  });
});
