import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatArea } from "../../src/components/layout/ChatArea";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Channel, Server, User } from "../../src/types";
import { defaultUIExtensions } from "../fixtures/uiState";

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    sendRaw: vi.fn(),
    sendTyping: vi.fn(),
    on: vi.fn(),
    getCurrentUser: vi.fn(() => ({ id: "test-user", username: "tester" })),
    getNick: vi.fn(() => "tester"),
    hasCapability: vi.fn(() => false),
    version: "1.0.0",
  },
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

Object.defineProperty(HTMLInputElement.prototype, "setSelectionRange", {
  value: vi.fn(),
  writable: true,
});

const mockUsers: User[] = [
  { id: "1", username: "alice", isOnline: true },
  { id: "2", username: "bob", isOnline: true },
  { id: "3", username: "charlie", isOnline: false },
  { id: "4", username: "admin", isOnline: true },
];

const mockChannel: Channel = {
  id: "channel1",
  name: "#general",
  topic: "General discussion",
  isPrivate: false,
  serverId: "server1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: mockUsers,
};

const mockServer: Server = {
  id: "server1",
  name: "Test Server",
  host: "irc.test.com",
  port: 6667,
  channels: [mockChannel],
  privateChats: [],
  isConnected: true,
  users: mockUsers,
};

describe("ChatArea Tab Completion Integration", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [mockServer],
      currentUser: { id: "user1", username: "testuser", isOnline: true },
      ui: {
        selectedServerId: "server1",
        perServerSelections: {
          server1: {
            selectedChannelId: "channel1",
            selectedPrivateChatId: null,
          },
        },
        isNarrowView: false,
        isMemberListVisible: true,
        isChannelListVisible: true,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: true,
        isMobileMenuOpen: false,
        isChannelListModalOpen: false,
        linkSecurityWarnings: [],
        mobileViewActiveColumn: "serverList",
        isServerMenuOpen: false,
        contextMenu: {
          isOpen: false,
          x: 0,
          y: 0,
          type: "server",
          itemId: null,
        },
        prefillServerDetails: null,
        inputAttachments: [],
        // Server notices popup state
        isServerNoticesPopupOpen: false,
        serverNoticesPopupMinimized: false,
        profileViewRequest: null,
        settingsNavigation: null,
        shouldFocusChatInput: false,
        pendingBotsModalOpen: null,
        pendingBotCommandPick: null,
        ...defaultUIExtensions,
      },
      messages: {},
      typingUsers: {},
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should complete nicknames with Tab key", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "al");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("alice: ");
  });

  it("should cycle through multiple matches on subsequent Tab presses", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "a");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    expect(input).toHaveValue("admin: ");

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    expect(input).toHaveValue("alice: ");

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    expect(input).toHaveValue("admin: ");
  });

  it("should add colon when completing at message start", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "bo");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("bob: ");
  });

  it("should add space when completing in middle of message", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "hello bo");

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("hello bob ");
  });

  it("should reset completion on other key presses", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "al");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    await userEvent.type(input, "x");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("alice: x");
  });

  it("should not complete if no matches found", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "xyz");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("xyz");
  });

  it("should send message on Enter key", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "Hello everyone!");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(ircClient.sendRaw).toHaveBeenCalledWith(
      "server1",
      expect.stringContaining("PRIVMSG #general :Hello everyone!"),
    );

    expect(input).toHaveValue("");
  });

  it("should handle case-insensitive matching", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "BO");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("bob: ");
  });

  it("should handle empty channel users gracefully", async () => {
    const emptyChannel = { ...mockChannel, users: [] };
    const emptyServer = { ...mockServer, channels: [emptyChannel] };

    useStore.setState({
      servers: [emptyServer],
    });

    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "test");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("test");
  });

  it("should focus input after tab completion", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "bo");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveFocus();
  });

  it("should not interfere with typing when no matches found", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "xyz");

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("xyz");
  });

  it("should not fill input with completion when Enter is pressed while dropdown is visible", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "hello bo");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("hello bob ");

    await userEvent.type(input, "how are you?");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(input).toHaveValue("");
    expect(ircClient.sendRaw).toHaveBeenCalledWith(
      "server1",
      expect.stringContaining("PRIVMSG #general :hello bob how are you?"),
    );
  });

  it("should not move cursor when arrow keys are pressed with dropdown visible", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "a");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("admin: ");

    const initialCursorPosition = (input as HTMLInputElement).selectionStart;

    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });

    expect((input as HTMLInputElement).selectionStart).toBe(
      initialCursorPosition,
    );

    fireEvent.keyDown(input, { key: "Up", code: "ArrowUp" });

    expect((input as HTMLInputElement).selectionStart).toBe(
      initialCursorPosition,
    );
  });

  it("should handle Enter key properly during tab completion", async () => {
    render(<ChatArea onToggleChanList={() => {}} isChanListVisible={true} />);

    const input = screen.getByPlaceholderText(/Message #general/i);

    await userEvent.type(input, "a");
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    expect(input).toHaveValue("admin: ");

    // Type additional text and then send message normally
    await userEvent.type(input, "hello");

    // Clear any previous calls to sendRaw
    vi.clearAllMocks();

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Should send the complete message
    expect(ircClient.sendRaw).toHaveBeenCalledWith(
      "server1",
      expect.stringContaining("PRIVMSG #general :admin: hello"),
    );
  });
});

const makeMsg = (
  id: string,
  overrides?: Partial<import("../../src/types").Message>,
): import("../../src/types").Message => ({
  id,
  msgid: id,
  type: "message",
  content: `Message ${id}`,
  timestamp: new Date("2024-01-01T12:00:00Z"),
  userId: "alice",
  channelId: "channel1",
  serverId: "server1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
  ...overrides,
});

// channelKey = `${selectedServerId}-${selectedChannelId}` = "server1-channel1"
const NAV_CHANNEL_KEY = "server1-channel1";

describe("ChatArea reply keyboard navigation", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [mockServer],
      currentUser: { id: "user1", username: "testuser", isOnline: true },
      messages: {
        [NAV_CHANNEL_KEY]: [makeMsg("msg-old"), makeMsg("msg-new")],
      },
      ui: {
        selectedServerId: "server1",
        perServerSelections: {
          server1: {
            selectedChannelId: "channel1",
            selectedPrivateChatId: null,
          },
        },
        isNarrowView: false,
        isMemberListVisible: true,
        isChannelListVisible: true,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: true,
        isMobileMenuOpen: false,
        isChannelListModalOpen: false,
        linkSecurityWarnings: [],
        mobileViewActiveColumn: "serverList",
        isServerMenuOpen: false,
        contextMenu: {
          isOpen: false,
          x: 0,
          y: 0,
          type: "server",
          itemId: null,
        },
        prefillServerDetails: null,
        inputAttachments: [],
        isServerNoticesPopupOpen: false,
        serverNoticesPopupMinimized: false,
        profileViewRequest: null,
        settingsNavigation: null,
        shouldFocusChatInput: false,
        pendingBotsModalOpen: null,
        pendingBotCommandPick: null,
        ...defaultUIExtensions,
      },
      typingUsers: {},
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Ctrl+↑ opens reply banner for the most recent repliable message", () => {
    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    expect(container.querySelector(".rounded-t-lg")).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });

    // Reply banner (MessageReply with onClose) has rounded-t-lg
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();
    // Input area switches to rounded-b-lg when a reply is active
    expect(container.querySelector(".rounded-b-lg")).not.toBeNull();
  });

  it("Ctrl+↑ twice navigates to the older message", () => {
    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    // First press → newest (msg-new)
    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    const bannerAfterFirst = container.querySelector(".rounded-t-lg");
    expect(bannerAfterFirst).not.toBeNull();

    // Second press → older (msg-old) — banner stays but target changes
    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();
  });

  it("Ctrl+↓ past the newest message cancels the reply", () => {
    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    // Open nav
    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();

    // Navigate back past newest
    fireEvent.keyDown(input, { key: "ArrowDown", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).toBeNull();
    expect(container.querySelector(".rounded-b-lg")).toBeNull();
  });

  it("Escape cancels keyboard nav and clears the reply", () => {
    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector(".rounded-t-lg")).toBeNull();
  });

  it("typing a letter exits nav mode but keeps the reply banner", () => {
    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();

    // A regular key press exits nav mode (highlight removed) but localReplyTo stays
    fireEvent.keyDown(input, { key: "h" });
    expect(container.querySelector(".rounded-t-lg")).not.toBeNull();
  });

  it("ignores Ctrl+↑ when there are no repliable messages", () => {
    useStore.setState({ messages: { [NAV_CHANNEL_KEY]: [] } });

    const { container } = render(
      <ChatArea onToggleChanList={() => {}} isChanListVisible={true} />,
    );
    const input = screen.getByPlaceholderText(/Message #general/i);

    fireEvent.keyDown(input, { key: "ArrowUp", ctrlKey: true });
    expect(container.querySelector(".rounded-t-lg")).toBeNull();
  });
});
