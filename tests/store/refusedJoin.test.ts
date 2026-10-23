import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import {
  installLocalStorageBacking,
  lsBacking,
} from "../fixtures/localStorageBacking";

const SERVER = "srv-1";

const channelNames = () =>
  useStore.getState().servers[0].channels.map((c) => c.name);

describe("a join the server refuses", () => {
  const savedChannels = () =>
    JSON.parse(lsBacking.get("savedServers") ?? "[]")[0].channels;

  beforeEach(() => {
    installLocalStorageBacking();
    lsBacking.set(
      "savedServers",
      JSON.stringify([
        {
          id: SERVER,
          host: "irc.test",
          port: 6667,
          nickname: "me",
          channels: ["#saved"],
        },
      ]),
    );
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
    expect(savedChannels()).toEqual(["#saved"]);
  });

  it("keeps a saved channel when its autojoin is refused", () => {
    useStore.getState().joinChannel(SERVER, "#saved");

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#saved",
      isThrottled: false,
    });

    expect(channelNames()).toEqual(["#saved"]);
    expect(savedChannels()).toEqual(["#saved"]);
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

  it("matches the server's casing when it refuses a join", () => {
    useStore.getState().joinChannel(SERVER, "#Closed");

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#closed",
      isThrottled: false,
    });

    expect(channelNames()).toEqual([]);
    expect(savedChannels()).toEqual(["#saved"]);
  });

  it("drops a refused join on a bouncer network", () => {
    useStore.setState((state) => ({
      servers: state.servers.map((s) => ({ ...s, bouncerNetid: "n1" })),
    }));
    useStore.getState().joinChannel(SERVER, "#banned");

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#banned",
      isThrottled: false,
    });

    expect(channelNames()).toEqual([]);
  });
});
