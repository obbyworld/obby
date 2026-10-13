import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const SERVER = "srv-1";

const channelNames = () =>
  useStore.getState().servers[0].channels.map((c) => c.name);

describe("a join the server refuses", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    (ircClient as unknown as { servers: Map<string, unknown> }).servers.set(
      SERVER,
      { id: SERVER, channels: [], capabilities: [] },
    );
    useStore.setState({
      servers: [
        {
          id: SERVER,
          name: "Test",
          host: "irc.test",
          port: 6667,
          channels: [],
          privateChats: [],
          users: [],
          isConnected: true,
        },
      ],
      channelOrder: {},
    } as Partial<AppState>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (ircClient as unknown as { servers: Map<string, unknown> }).servers.delete(
      SERVER,
    );
  });

  it("drops the channel the user just asked to join", () => {
    useStore.getState().joinChannel(SERVER, "#closed");
    expect(channelNames()).toEqual(["#closed"]);

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#closed",
      isThrottled: false,
    });

    expect(channelNames()).toEqual([]);
  });

  it("keeps a channel the server already confirmed", () => {
    vi.spyOn(ircClient, "getNick").mockReturnValue("me");
    useStore.getState().joinChannel(SERVER, "#open");
    ircClient.triggerEvent("JOIN", {
      serverId: SERVER,
      username: "me",
      channelName: "#open",
    });

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#open",
      isThrottled: false,
    });

    expect(channelNames()).toEqual(["#open"]);
  });
});
