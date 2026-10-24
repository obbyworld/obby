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
      numeric: "474",
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
      numeric: "474",
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
      numeric: "474",
    });

    expect(channelNames()).toEqual(["#open"]);
  });

  it("matches the server's casing when it refuses a join", () => {
    useStore.getState().joinChannel(SERVER, "#Closed");

    ircClient.triggerEvent("JOIN_REFUSED", {
      serverId: SERVER,
      channelName: "#closed",
      isThrottled: false,
      numeric: "474",
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
      numeric: "474",
    });

    expect(channelNames()).toEqual([]);
  });

  describe("a channel that needs a key", () => {
    const refuseWithBadKey = (channelName: string) =>
      (
        ircClient as unknown as {
          handleMessage(data: string, serverId: string): void;
        }
      ).handleMessage(
        `:irc.test 475 me ${channelName} :Cannot join channel (+k)\r\n`,
        SERVER,
      );
    const needsKey = (channelName: string) =>
      useStore
        .getState()
        .servers[0].channels.find((c) => c.name === channelName)?.needsKey;

    afterEach(() => {
      useStore.setState({ channelKeyPrompt: null });
    });

    it("asks for the key when a join the user started is refused", () => {
      useStore.getState().joinChannel(SERVER, "#vault");
      refuseWithBadKey("#vault");

      expect(useStore.getState().channelKeyPrompt).toEqual({
        serverId: SERVER,
        channelName: "#vault",
        isWrongKey: false,
      });
    });

    it("tells the user the key was wrong when a keyed join is refused", () => {
      useStore.getState().joinChannel(SERVER, "#vault", "nope");
      refuseWithBadKey("#vault");

      expect(useStore.getState().channelKeyPrompt).toEqual({
        serverId: SERVER,
        channelName: "#vault",
        isWrongKey: true,
      });
    });

    it("marks a saved channel needing a key and opens no dialog", () => {
      useStore.getState().joinChannel(SERVER, "#saved");
      refuseWithBadKey("#saved");

      expect(needsKey("#saved")).toBe(true);
      expect(useStore.getState().channelKeyPrompt).toBeNull();
    });

    it("asks for the key when the user selects a channel that needs one", () => {
      useStore.getState().joinChannel(SERVER, "#saved");
      refuseWithBadKey("#saved");
      const channel = useStore.getState().servers[0].channels[0];

      useStore.getState().selectChannel(channel.id, { navigate: true });

      expect(useStore.getState().channelKeyPrompt).toEqual({
        serverId: SERVER,
        channelName: "#saved",
        isWrongKey: false,
      });
    });

    it("clears the mark once the join goes through", () => {
      vi.spyOn(ircClient, "getNick").mockReturnValue("me");
      useStore.getState().joinChannel(SERVER, "#saved");
      refuseWithBadKey("#saved");
      expect(needsKey("#saved")).toBe(true);

      ircClient.triggerEvent("JOIN", {
        serverId: SERVER,
        username: "me",
        channelName: "#saved",
      });

      expect(needsKey("#saved")).toBeFalsy();
      expect(ircClient.sendRaw).toHaveBeenCalledWith(
        SERVER,
        "WHO #saved %cuhnfaro",
      );
    });

    it("leaves other refusals alone", () => {
      useStore.getState().joinChannel(SERVER, "#saved");
      ircClient.triggerEvent("JOIN_REFUSED", {
        serverId: SERVER,
        channelName: "#saved",
        isThrottled: false,
        numeric: "474",
      });

      expect(needsKey("#saved")).toBeFalsy();
      expect(useStore.getState().channelKeyPrompt).toBeNull();
    });
  });
});
