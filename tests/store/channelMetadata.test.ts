import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const name = "#!/bin/bash";
const avatar = "https://files.example.com/avatar.png";

describe("channel metadata", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "getNick").mockReturnValue("me");
    useStore.setState({
      servers: [
        {
          id: "chan-meta",
          name: "TestServer",
          host: "irc.example.com",
          port: 6697,
          channels: [
            {
              id: "chan-1",
              name,
              serverId: "chan-meta",
              isPrivate: false,
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [],
            },
          ],
          privateChats: [],
          users: [],
          isConnected: true,
        },
      ],
    } as Partial<AppState>);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(["METADATA", "METADATA_KEYVALUE"] as const)(
    "applies %s to a channel whose name holds a !",
    (event) => {
      ircClient.triggerEvent(event, {
        serverId: "chan-meta",
        target: name,
        key: "avatar",
        visibility: "*",
        value: avatar,
      });

      const channel = useStore.getState().servers[0].channels[0];
      expect(channel.metadata?.avatar?.value).toBe(avatar);
    },
  );
});
