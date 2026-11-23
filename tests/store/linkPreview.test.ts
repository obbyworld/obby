import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Message } from "../../src/types";

const KEY = "srv-1-chan-1";

const message: Message = {
  id: "with-link",
  msgid: "with-link",
  type: "message",
  content: "look https://example.com/page",
  timestamp: new Date(),
  userId: "alice",
  channelId: "chan-1",
  serverId: "srv-1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
};

function setup() {
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
            users: [],
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
    messages: { [KEY]: [message] },
  });
}

const feed = (line: string) =>
  (
    ircClient as unknown as {
      handleMessage: (data: string, serverId: string) => void;
    }
  ).handleMessage(`${line}\r\n`, "srv-1");

describe("link preview tags", () => {
  beforeEach(setup);

  it("shows preview text exactly as the server escaped it once", () => {
    feed(
      String.raw`@+reply=with-link;obsidianirc/link-preview-title=C:\\server;obsidianirc/link-preview-snippet=verify\syour\spassword :irc.example.com TAGMSG #general`,
    );
    const stored = useStore
      .getState()
      .messages[KEY].find((m) => m.msgid === "with-link");
    expect(stored?.linkPreviewTitle).toBe("C:\\server");
    expect(stored?.linkPreviewSnippet).toBe("verify your password");
  });
});
