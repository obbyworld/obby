import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState, loadSavedServers } from "../../src/store";
import type { Server, ServerConfig } from "../../src/types";
import {
  installLocalStorageBacking,
  lsBacking,
} from "../fixtures/localStorageBacking";

const savedServer = (
  id: string,
  extra: Partial<ServerConfig> = {},
): ServerConfig => ({
  id,
  name: id,
  host: `wss://${id}.example:443`,
  port: 443,
  nickname: "alice",
  saslEnabled: false,
  channels: [],
  ...extra,
});

const liveServer = (id: string, extra: Partial<Server> = {}): Server => ({
  id,
  name: id,
  host: `${id}.example`,
  port: 443,
  channels: [],
  privateChats: [],
  isConnected: true,
  connectionState: "connected",
  users: [],
  ...extra,
});

describe("turning a saved server off and on", () => {
  let connect: MockInstance;

  beforeEach(() => {
    installLocalStorageBacking();
    useStore.setState({
      servers: [],
      hasConnectedToSavedServers: false,
    } as Partial<AppState>);
    connect = vi
      .spyOn(useStore.getState(), "connect")
      .mockResolvedValue(undefined as never);
    connect.mockClear();
    vi.spyOn(ircClient, "removeServer");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lsBacking.clear();
  });

  test("leaves a server saved as off unconnected at startup, and connects the rest", async () => {
    lsBacking.set(
      "savedServers",
      JSON.stringify([
        savedServer("off", { enabled: false }),
        savedServer("legacy"),
      ]),
    );
    await useStore.getState().connectToSavedServers();

    const off = useStore.getState().servers.find((s) => s.id === "off");
    expect(off).toMatchObject({
      isDisabled: true,
      connectionState: "disconnected",
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]).toContain("legacy");
  });

  test("turning off saves the flag, quits, and drops a bouncer's networks", () => {
    lsBacking.set(
      "savedServers",
      JSON.stringify([savedServer("bnc", { isBouncerControl: true })]),
    );
    useStore.setState({
      servers: [
        liveServer("bnc", { isBouncerControl: true }),
        liveServer("net", { bouncerServerId: "bnc", bouncerNetid: "1" }),
      ],
    } as Partial<AppState>);

    useStore.getState().setServerEnabled("bnc", false);

    expect(loadSavedServers()[0].enabled).toBe(false);
    expect(ircClient.removeServer).toHaveBeenCalledWith("bnc");
    expect(ircClient.removeServer).toHaveBeenCalledWith("net");
    expect(useStore.getState().servers.map((s) => s.id)).toEqual(["bnc"]);
    expect(useStore.getState().servers[0].isDisabled).toBe(true);
  });

  test("a disabled server ignores reconnects until it is turned back on", async () => {
    lsBacking.set(
      "savedServers",
      JSON.stringify([savedServer("srv", { enabled: false })]),
    );
    useStore.setState({
      servers: [
        liveServer("srv", {
          isDisabled: true,
          isConnected: false,
          connectionState: "disconnected",
        }),
      ],
    } as Partial<AppState>);

    await useStore.getState().reconnectServer("srv");
    expect(connect).not.toHaveBeenCalled();

    useStore.getState().setServerEnabled("srv", true);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(loadSavedServers()[0].enabled).toBe(true);
    expect(useStore.getState().servers[0].isDisabled).toBe(false);
  });
});
