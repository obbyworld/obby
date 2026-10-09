import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";

const TYPING_KEY = "srv-1-chan-1";

function setupServer() {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "chan-1",
            name: "#general",
            topic: "",
            users: [{ id: "alice", username: "alice", isOnline: true }],
            messages: [],
            isPrivate: false,
            serverId: "srv-1",
            unreadCount: 0,
            isMentioned: false,
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
      },
    ],
    typingUsers: {},
    typingTimers: {},
  });
}

const typing = (mtags: Record<string, string>) =>
  ircClient.triggerEvent("TAGMSG", {
    serverId: "srv-1",
    sender: "alice",
    channelName: "#general",
    mtags,
    timestamp: new Date(),
  });

describe("typing tags", () => {
  beforeEach(setupServer);

  it("shows a live typing tag", () => {
    typing({ "+typing": "active" });
    expect(
      useStore.getState().typingUsers[TYPING_KEY]?.map((u) => u.username),
    ).toEqual(["alice"]);
  });

  it("ignores a typing tag replayed inside a history batch", () => {
    typing({ "+typing": "active", batch: "history-1" });
    expect(useStore.getState().typingUsers[TYPING_KEY] ?? []).toEqual([]);
  });
});
