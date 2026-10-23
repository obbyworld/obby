import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageItem } from "../../src/components/message/MessageItem";
import { E2EE_SESSION_TAG } from "../../src/lib/e2ee/messageFlags";
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

const URL = "https://github.com/obbyworld/obby/pull/42";

beforeEach(() => {
  useStore.setState({ servers: [mockServer] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("link labels from server previews", () => {
  it("shows the host and the preview title in place of the address", () => {
    render(
      <MessageItem
        message={makeMessage({
          content: `look ${URL}`,
          linkPreviewTitle: "Fix highlights &middot; Pull Request #42",
        })}
        {...baseProps}
      />,
    );
    const link = screen.getByRole("link", {
      name: "github.com · Fix highlights · Pull Request #42",
    });
    expect(link).toHaveAttribute("href", URL);
  });

  it("shows a compact address without a server preview", () => {
    render(
      <MessageItem
        message={makeMessage({ content: `look ${URL}` })}
        {...baseProps}
      />,
    );
    expect(
      screen.getByRole("link", { name: "github.com/obbyworld/obby/pull/42" }),
    ).toHaveAttribute("href", URL);
  });

  it("never relabels a link in an encrypted message", () => {
    render(
      <MessageItem
        message={makeMessage({
          content: `look ${URL}`,
          linkPreviewTitle: "Your bank login",
          tags: { [E2EE_SESSION_TAG]: "1" },
        })}
        {...baseProps}
      />,
    );
    expect(
      screen.getByRole("link", { name: "github.com/obbyworld/obby/pull/42" }),
    ).toHaveAttribute("href", URL);
    expect(screen.queryByText(/Your bank login/)).toBeNull();
  });
});
