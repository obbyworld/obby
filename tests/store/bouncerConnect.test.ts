import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";

const BOUNCER_ID = "ctl-bouncer-1";

// localStorage is globally mocked in tests/setup.ts; back it with a
// real Map per test so storage.servers.load() / save() actually round
// trip.
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

function seedParentServer() {
  installLocalStorageBacking();
  lsBacking.set(
    "savedServers",
    JSON.stringify([
      {
        id: BOUNCER_ID,
        host: "wss://soju.example",
        port: 6697,
        nickname: "alice",
        saslEnabled: true,
        saslAccountName: "alice",
        saslPassword: "secret",
        channels: [],
        isBouncerControl: true,
      },
    ]),
  );
  useStore.setState({
    servers: [
      {
        id: BOUNCER_ID,
        name: "soju",
        host: "wss://soju.example",
        port: 6697,
        channels: [],
        privateChats: [],
        users: [],
        isConnected: true,
        isBouncerControl: true,
      },
    ],
    bouncers: {
      [BOUNCER_ID]: {
        serverId: BOUNCER_ID,
        supported: true,
        notifyEnabled: true,
        networks: {
          "42": {
            netid: "42",
            attributes: { name: "Libera", host: "irc.libera.chat" },
          },
        },
        listed: true,
      },
    },
  } as Partial<AppState>);
}

describe("bouncerConnectNetwork action", () => {
  beforeEach(() => {
    seedParentServer();
    vi.spyOn(ircClient, "connect").mockResolvedValue(undefined as never);
    vi.spyOn(ircClient, "setPendingBouncerBind");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lsBacking.clear();
    useStore.setState({ servers: [], bouncers: {} } as Partial<AppState>);
  });

  test("queues BOUNCER BIND on a fresh childId before calling connect", async () => {
    await useStore.getState().bouncerConnectNetwork(BOUNCER_ID, "42");

    // setPendingBouncerBind was called with a new id (not the bouncer's id)
    expect(ircClient.setPendingBouncerBind).toHaveBeenCalledTimes(1);
    const [childId, netid] = (
      ircClient.setPendingBouncerBind as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(netid).toBe("42");
    expect(childId).not.toBe(BOUNCER_ID);

    // ...and connect() was invoked with the same id
    expect(ircClient.connect).toHaveBeenCalledTimes(1);
    const connectArgs = (ircClient.connect as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(connectArgs[connectArgs.length - 1]).toBe(childId);
  });

  test("seeds the child Server with bouncer linkage and connecting state", async () => {
    await useStore.getState().bouncerConnectNetwork(BOUNCER_ID, "42");
    const child = useStore
      .getState()
      .servers.find((s) => s.bouncerNetid === "42");
    expect(child).toBeDefined();
    expect(child?.bouncerServerId).toBe(BOUNCER_ID);
    expect(child?.isBouncerControl).toBeFalsy();
    expect(child?.connectionState).toBe("connecting");
    // Friendly name comes from the BOUNCER NETWORK attribute "name".
    expect(child?.name).toBe("Libera");
  });

  test("persists the child ServerConfig with parent's credentials", async () => {
    await useStore.getState().bouncerConnectNetwork(BOUNCER_ID, "42");
    const saved = JSON.parse(lsBacking.get("savedServers") ?? "[]") as Array<{
      bouncerNetid?: string;
      bouncerServerId?: string;
      saslAccountName?: string;
      saslPassword?: string;
      host?: string;
      port?: number;
    }>;
    const child = saved.find((s) => s.bouncerNetid === "42");
    expect(child).toBeDefined();
    expect(child?.bouncerServerId).toBe(BOUNCER_ID);
    expect(child?.saslAccountName).toBe("alice");
    expect(child?.saslPassword).toBe("secret");
    expect(child?.host).toBe("wss://soju.example");
    expect(child?.port).toBe(6697);
  });

  test("repeated calls for the same netid are idempotent for persistence", async () => {
    await useStore.getState().bouncerConnectNetwork(BOUNCER_ID, "42");
    await useStore.getState().bouncerConnectNetwork(BOUNCER_ID, "42");
    const saved = JSON.parse(lsBacking.get("savedServers") ?? "[]") as Array<{
      bouncerNetid?: string;
    }>;
    const matches = saved.filter((s) => s.bouncerNetid === "42");
    expect(matches).toHaveLength(1);
  });

  test("returns undefined when the parent bouncer has no saved config", async () => {
    lsBacking.set("savedServers", "[]");
    const result = await useStore
      .getState()
      .bouncerConnectNetwork(BOUNCER_ID, "42");
    expect(result).toBeUndefined();
    expect(ircClient.connect).not.toHaveBeenCalled();
  });
});
