import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { MessageItem } from "../../src/components/message/MessageItem";
import useStore, { type AppState } from "../../src/store";
import * as storage from "../../src/store/localStorage";
import type { Channel, Message, Server, User } from "../../src/types";

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

const alice: User = { id: "alice-id", username: "alice", isOnline: true };

function makeServer(overrides: Partial<Server> = {}): Server {
  const channel: Channel = {
    id: "channel1",
    name: "#general",
    topic: "",
    isPrivate: false,
    serverId: "server1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [alice],
  };
  return {
    id: "server1",
    name: "Test Server",
    host: "irc.test.com",
    port: 6667,
    channels: [channel],
    privateChats: [],
    isConnected: true,
    users: [],
    capabilities: ["draft/metadata-2"],
    ...overrides,
  };
}

const message: Message = {
  id: "m1",
  msgid: "m1",
  type: "message",
  content: "hello from history",
  timestamp: new Date(),
  userId: "alice",
  channelId: "channel1",
  serverId: "server1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
};

const props = {
  message,
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

let metadataList: Mock<AppState["metadataList"]>;

beforeEach(() => {
  metadataList = vi.fn<AppState["metadataList"]>();
  useStore.setState({ metadataList });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the author of a shown message", () => {
  it("gets their profile fetched with no member list open", () => {
    useStore.setState({ servers: [makeServer()] });
    render(<MessageItem {...props} />);
    expect(metadataList).toHaveBeenCalledWith("server1", "alice");
  });

  it("gets fetched once the server grants metadata", () => {
    useStore.setState({ servers: [makeServer({ capabilities: [] })] });
    render(<MessageItem {...props} />);
    expect(metadataList).not.toHaveBeenCalled();

    act(() => useStore.setState({ servers: [makeServer()] }));
    expect(metadataList).toHaveBeenCalledWith("server1", "alice");
  });

  it("shows the saved profile of an author who left the channel", () => {
    storage.metadata.save({
      server1: { bob: { "display-name": { value: "Bobby", visibility: "*" } } },
    });
    useStore.setState({ servers: [makeServer()] });
    render(<MessageItem {...props} message={{ ...message, userId: "bob" }} />);
    expect(metadataList).toHaveBeenCalledWith("server1", "bob");
    expect(screen.getByText("Bobby")).toBeInTheDocument();
    storage.metadata.save({});
  });

  it("is left alone on a grouped follow-up line", () => {
    useStore.setState({ servers: [makeServer()] });
    render(<MessageItem {...props} showHeader={false} />);
    expect(metadataList).not.toHaveBeenCalled();
  });
});
