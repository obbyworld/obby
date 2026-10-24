import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageItem } from "../../src/components/message/MessageItem";
import useStore from "../../src/store";
import type { Channel, Message, Server } from "../../src/types";

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    getCurrentUser: vi.fn(() => ({
      id: "u1",
      username: "mattf",
      isOnline: true,
    })),
    getNick: vi.fn(() => "mattf"),
    hasCapability: vi.fn(() => false),
    on: vi.fn(),
    sendRaw: vi.fn(),
  },
}));

const mockChannel: Channel = {
  id: "channel1",
  name: "#general",
  topic: "",
  isPrivate: false,
  serverId: "server1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: [],
};

const mockServer: Server = {
  id: "server1",
  name: "Test Server",
  host: "irc.test.com",
  port: 6667,
  channels: [mockChannel],
  privateChats: [],
  isConnected: true,
  users: [],
};

const timestamp = new Date(2024, 0, 1, 14, 37);
const time = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
}).format(timestamp);

const followOn: Message = {
  id: "m1",
  msgid: "m1",
  type: "message",
  content: "second line",
  timestamp,
  userId: "alice",
  channelId: "channel1",
  serverId: "server1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
};

function renderFollowOn() {
  render(
    <MessageItem
      message={followOn}
      showDate={false}
      showHeader={false}
      setReplyTo={vi.fn()}
      onUsernameContextMenu={vi.fn()}
      onReactClick={vi.fn()}
      onReactionUnreact={vi.fn()}
      onOpenReactionModal={vi.fn()}
      onDirectReaction={vi.fn()}
      serverId="server1"
      channelId="channel1"
    />,
  );
  return screen.getByText(time);
}

function setAlwaysShowTimestamps(alwaysShowTimestamps: boolean) {
  useStore.setState((state) => ({
    globalSettings: { ...state.globalSettings, alwaysShowTimestamps },
  }));
}

beforeEach(() => {
  useStore.setState({ servers: [mockServer] });
});

afterEach(() => {
  cleanup();
  setAlwaysShowTimestamps(false);
});

describe("the time on a grouped follow-on message", () => {
  it("shows on hover by default", () => {
    expect(renderFollowOn()).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
    );
  });

  it("always shows when the setting is on", () => {
    setAlwaysShowTimestamps(true);
    expect(renderFollowOn()).not.toHaveClass("opacity-0");
  });
});
