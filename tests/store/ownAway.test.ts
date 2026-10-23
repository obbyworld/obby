import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

function ownChannelEntry() {
  return useStore
    .getState()
    .servers[0].channels[0].users.find((u) => u.username === "Me");
}

describe("our own away state", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "getNick").mockReturnValue("me");
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
              name: "#test",
              serverId: "srv-1",
              isPrivate: false,
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [
                { id: "me-id", username: "Me", isOnline: true, isAway: true },
              ],
            },
          ],
          privateChats: [],
          users: [],
          isConnected: true,
          isAway: true,
        },
      ],
    } as Partial<AppState>);
  });

  afterEach(() => vi.restoreAllMocks());

  it("clears the away dot on our channel entries when the server says we are back", () => {
    ircClient.triggerEvent("RPL_UNAWAY", {
      serverId: "srv-1",
      message: "You are no longer marked as being away",
    });

    expect(useStore.getState().servers[0].isAway).toBe(false);
    expect(ownChannelEntry()?.isAway).toBe(false);
  });

  it("sets the away dot on our channel entries when the server says we are away", () => {
    ircClient.triggerEvent("RPL_UNAWAY", { serverId: "srv-1", message: "" });
    ircClient.triggerEvent("RPL_NOWAWAY", {
      serverId: "srv-1",
      message: "You have been marked as being away",
    });

    expect(ownChannelEntry()?.isAway).toBe(true);
  });
});
