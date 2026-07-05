import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IRCClient } from "../../src/lib/ircClient";
import { registerModeHandler } from "../../src/protocol/mode";
import useStore from "../../src/store";
import type { Server } from "../../src/types";
import { defaultUIExtensions } from "../fixtures/uiState";

// Mock IRC client
const mockIRCClient = {
  on: vi.fn(),
};

describe("MODE Protocol Handler", () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      servers: [],
      currentUser: null,
      isConnecting: false,
      selectedServerId: null,
      connectionError: null,
      messages: {},
      typingUsers: {},
      channelList: {},
      listingInProgress: {},
      ui: {
        selectedServerId: null,
        perServerSelections: {},
        isNarrowView: false,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: true,
        isMobileMenuOpen: false,
        isMemberListVisible: true,
        isChannelListVisible: true,
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
    });
    vi.clearAllMocks();
  });

  describe("registerModeHandler", () => {
    test("should register MODE event handler", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      expect(mockIRCClient.on).toHaveBeenCalledWith(
        "MODE",
        expect.any(Function),
      );
    });
  });

  describe("MODE event handling", () => {
    test("should handle channel mode changes with op", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      // Get the MODE handler function
      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      // Set up initial state with server and channel
      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "",
                isOnline: true,
              },
              {
                id: "user2",
                username: "user2",
                status: "",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      // Call the MODE handler
      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o",
        modeargs: ["user1"],
      });

      // Check that the user's status was updated
      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      expect(updatedUser?.status).toBe("@");

      // Check that a system message was added to the global messages store
      const state = useStore.getState();
      const channelKey = `${server.id}-${updatedChannel.id}`;
      const channelMessages = state.messages[channelKey] || [];
      expect(channelMessages).toHaveLength(1);
      expect(channelMessages[0].type).toBe("mode");
      expect(channelMessages[0].content).toBe("sets mode: +o user1");
    });

    test("should handle channel mode changes with voice", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+v",
        modeargs: ["user1"],
      });

      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      expect(updatedUser?.status).toBe("+");
    });

    test("should handle mode removal", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "@",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "-o",
        modeargs: ["user1"],
      });

      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      expect(updatedUser?.status).toBe("");
    });

    test("should handle multiple modes in one command", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "",
                isOnline: true,
              },
              {
                id: "user2",
                username: "user2",
                status: "",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o-v",
        modeargs: ["user1", "user2"],
      });

      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser1 = updatedChannel.users.find(
        (u) => u.username === "user1",
      );
      const updatedUser2 = updatedChannel.users.find(
        (u) => u.username === "user2",
      );

      expect(updatedUser1?.status).toBe("@");
      expect(updatedUser2?.status).toBe("");
    });

    test("should handle custom prefix configurations", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(qaohv)~&@%+", // Custom prefix configuration
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+q",
        modeargs: ["user1"],
      });

      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      expect(updatedUser?.status).toBe("~");
    });

    test("should handle multiple prefixes on same user", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "+",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      // Give user op status while they already have voice
      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o",
        modeargs: ["user1"],
      });

      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      // Should have both @ and + with @ first (higher precedence)
      expect(updatedUser?.status).toBe("@+");
    });

    test("should ignore MODE events for non-existent servers", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      // Call with non-existent server ID
      modeHandler({
        serverId: "non-existent-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o",
        modeargs: ["user1"],
      });

      // State should remain unchanged
      expect(useStore.getState().servers).toEqual([]);
    });

    test("should ignore MODE events for non-existent channels", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [],
        privateChats: [],
        isConnected: true,
        users: [],
        prefix: "(ov)@+",
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#nonexistent",
        modestring: "+o",
        modeargs: ["user1"],
      });

      // State should remain unchanged
      const updatedServer = useStore.getState().servers[0];
      expect(updatedServer.channels).toEqual([]);
    });

    test("should ignore MODE events when server has no prefix configured", () => {
      registerModeHandler(mockIRCClient as unknown as IRCClient, useStore);

      const modeCall = mockIRCClient.on.mock.calls.find(
        (call) => call[0] === "MODE",
      );
      expect(modeCall).toBeDefined();
      const modeHandler = modeCall?.[1];

      const server: Server = {
        id: "test-server",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "test-channel",
            name: "#testchannel",
            topic: "",
            isPrivate: false,
            serverId: "test-server",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [
              {
                id: "user1",
                username: "user1",
                status: "",
                isOnline: true,
              },
            ],
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
        // No prefix configured
      };

      useStore.setState({ servers: [server] });

      modeHandler({
        serverId: "test-server",
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o",
        modeargs: ["user1"],
      });

      // User status should remain unchanged
      const updatedServer = useStore.getState().servers[0];
      const updatedChannel = updatedServer.channels[0];
      const updatedUser = updatedChannel.users.find(
        (u) => u.username === "user1",
      );

      expect(updatedUser?.status).toBe("");
    });
  });
});
