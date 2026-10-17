import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageItem } from "../../src/components/message/MessageItem";
import useStore from "../../src/store";
import type { Channel, Message, Server } from "../../src/types";

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    getCurrentUser: vi.fn(() => null),
    getNick: vi.fn(() => "tester"),
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
function makeMessage(content: string): Message {
  idCounter++;
  return {
    id: `m${idCounter}`,
    msgid: `m${idCounter}`,
    type: "message",
    content,
    timestamp: new Date(),
    userId: "alice",
    channelId: "channel1",
    serverId: "server1",
    reactions: [],
    replyMessage: null,
    mentioned: [],
  };
}

// A trusted-domain URL so extractMediaFromMessage assigns a known type
// ("image") directly, no async probe needed.
const IMAGE_URL = "https://imgur.com/photo123";

beforeEach(() => {
  useStore.setState((state) => ({
    servers: [mockServer],
    globalSettings: { ...state.globalSettings, mediaVisibilityLevel: 3 },
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MessageItem — preview failure falls back to URL text", () => {
  it("a single-URL message with a working preview hides the URL text", () => {
    const { container } = render(
      <MessageItem message={makeMessage(IMAGE_URL)} {...baseProps} />,
    );

    expect(container.querySelector("img")).toBeTruthy();
    expect(container.querySelector(`a[href="${IMAGE_URL}"]`)).toBeNull();
  });

  it("a single-URL message whose preview fails shows the URL text", async () => {
    const { container } = render(
      <MessageItem message={makeMessage(IMAGE_URL)} {...baseProps} />,
    );

    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: asserted truthy above
    fireEvent.error(img!);

    await waitFor(() => {
      expect(container.querySelector(`a[href="${IMAGE_URL}"]`)).toBeTruthy();
    });
    expect(container.querySelector("img")).toBeNull();
  });

  it("a message with text plus a URL always shows the text", () => {
    const { container } = render(
      <MessageItem
        message={makeMessage(`look at this ${IMAGE_URL}`)}
        {...baseProps}
      />,
    );

    expect(container.querySelector(`a[href="${IMAGE_URL}"]`)).toBeTruthy();
    expect(container.querySelector("img")).toBeTruthy();
  });
});
