import { describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const serverId = "srv-entry";

const server = (overrides: Partial<Server> = {}): Server => ({
  id: serverId,
  name: "s",
  host: "irc.example.com",
  port: 6697,
  channels: [],
  privateChats: [],
  users: [],
  isConnected: true,
  isRegistered: true,
  ...overrides,
});

describe("a dropped connection", () => {
  it("frees a registration still waiting for its reply", () => {
    useStore.setState({
      servers: [
        server({
          nickClaim: { account: "alice", storedPassword: "", stage: "sending" },
        }),
      ],
    });

    ircClient.triggerEvent("connectionStateChange", {
      serverId,
      connectionState: "disconnected",
    });

    expect(useStore.getState().servers[0].nickClaim).toBeUndefined();
  });

  it("returns a code still waiting for its reply to the verify form", () => {
    useStore.setState({
      servers: [
        server({
          nickClaim: {
            account: "alice",
            storedPassword: "",
            stage: "verifying",
          },
        }),
      ],
    });

    ircClient.triggerEvent("connectionStateChange", {
      serverId,
      connectionState: "disconnected",
    });

    expect(useStore.getState().servers[0].nickClaim?.stage).toBe("verify");
  });

  it("drops a channel list the drop cut short, so the browser lists again", () => {
    useStore.setState({
      servers: [server()],
      channelList: { [serverId]: [] },
      listingInProgress: { [serverId]: true },
    });

    ircClient.triggerEvent("connectionStateChange", {
      serverId,
      connectionState: "disconnected",
    });

    expect(useStore.getState().channelList[serverId]).toBeUndefined();
  });
});

describe("a channel without metadata", () => {
  it("counts as fetched once the server says the key is not set", () => {
    useStore.setState({
      servers: [server()],
      channelMetadataFetchQueue: { [serverId]: new Set(["#quiet"]) },
      channelMetadataCache: {},
    });

    ircClient.triggerEvent("METADATA_KEYNOTSET", {
      serverId,
      target: "#quiet",
      key: "avatar",
    });

    const state = useStore.getState();
    expect(state.channelMetadataFetchQueue[serverId]?.has("#quiet")).toBe(
      false,
    );
    expect(
      state.channelMetadataCache[serverId]?.["#quiet"]?.fetchedAt,
    ).toBeTypeOf("number");
  });
});
