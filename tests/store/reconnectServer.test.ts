import { beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const serverId = "srv-relogin";

describe("reconnectServer", () => {
  beforeEach(() => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key !== "savedServers"
        ? null
        : JSON.stringify([
            {
              id: serverId,
              host: "wss://irc.example.com",
              port: 443,
              nickname: "me",
              channels: [],
              saslEnabled: true,
              saslAccountName: "me",
              saslPassword: btoa("new-pass"),
            },
          ]),
    );
    useStore.setState({
      servers: [
        {
          id: serverId,
          name: "s",
          host: "irc.example.com",
          port: 443,
          channels: [],
          privateChats: [],
          isConnected: true,
          users: [],
        },
      ],
    } as unknown as AppState);
  });

  test("closes a live connection and logs in again with the saved credentials", async () => {
    const disconnect = vi
      .spyOn(ircClient, "disconnect")
      .mockImplementation((id) =>
        ircClient.triggerEvent("connectionStateChange", {
          serverId: id,
          connectionState: "disconnected",
        }),
      );
    const connect = vi
      .spyOn(useStore.getState(), "connect")
      .mockResolvedValue({} as never);
    useStore.setState({ connect });

    await useStore.getState().reconnectServer(serverId);

    expect(disconnect).toHaveBeenCalledWith(serverId, expect.anything());
    expect(connect).toHaveBeenCalledWith(
      expect.anything(),
      "wss://irc.example.com",
      443,
      "me",
      true,
      undefined,
      "me",
      btoa("new-pass"),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      serverId,
    );
  });
});
