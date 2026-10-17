import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageItem } from "../../src/components/message/MessageItem";
import useStore from "../../src/store";
import type { Channel, Message, Server } from "../../src/types";

const currentUser = { id: "u1", username: "mattf", isOnline: true };

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

const baseProps = {
  showDate: false,
  showHeader: true,
  setReplyTo: vi.fn(),
  onUsernameContextMenu: vi.fn(),
  onReactClick: vi.fn(),
  onReactionUnreact: vi.fn(),
  onOpenReactionModal: vi.fn(),
  onDirectReaction: vi.fn(),
  serverId: "server1",
  channelId: "channel1",
};

let idCounter = 0;
function makeMessage(overrides: Partial<Message> = {}): Message {
  idCounter++;
  return {
    id: `m${idCounter}`,
    msgid: `m${idCounter}`,
    type: "message",
    content: "some words",
    timestamp: new Date(),
    userId: "alice",
    channelId: "channel1",
    serverId: "server1",
    reactions: [],
    replyMessage: null,
    mentioned: [],
    ...overrides,
  };
}

const marked = (container: HTMLElement) =>
  !!container.querySelector(".message-aimed-at-us");

beforeEach(() => {
  useStore.setState({ servers: [mockServer] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a message aimed at us", () => {
  it("leaves an ordinary message alone", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} {...baseProps} />,
    );

    expect(marked(container)).toBe(false);
  });

  it("marks a message that names us", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          content: "mattf: look at this",
          mentioned: ["mattf"],
        })}
        {...baseProps}
      />,
    );

    expect(marked(container)).toBe(true);
  });

  it("marks a reply to something we said", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          replyMessage: makeMessage({ userId: currentUser.username }),
        })}
        {...baseProps}
      />,
    );

    expect(marked(container)).toBe(true);
  });

  it("leaves a reply to somebody else alone", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          replyMessage: makeMessage({ userId: "bob" }),
        })}
        {...baseProps}
      />,
    );

    expect(marked(container)).toBe(false);
  });

  // Our own message quoting our own nick is not someone reaching us.
  it("leaves our own message alone", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          userId: currentUser.username,
          content: "mattf: talking to myself",
          mentioned: ["mattf"],
        })}
        {...baseProps}
      />,
    );

    expect(marked(container)).toBe(false);
  });
});
