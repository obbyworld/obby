import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "../../../src/components/layout/ChatHeader";
import useStore from "../../../src/store";
import type { Channel, User } from "../../../src/types";
import { defaultUIExtensions } from "../../fixtures/uiState";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

const mockCurrentUser: User = {
  id: "user1",
  username: "testuser",
  isOnline: true,
};

const mockChannel: Channel = {
  id: "channel1",
  name: "#general",
  topic: "Test topic",
  isPrivate: false,
  serverId: "server1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: [mockCurrentUser],
  metadata: {},
};

describe("ChatHeader - Members Button", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [
        {
          id: "server1",
          name: "Test Server",
          host: "irc.test.com",
          port: 6667,
          channels: [mockChannel],
          privateChats: [],
          isConnected: true,
          users: [mockCurrentUser],
          connectionState: "connected",
        },
      ],
      currentUser: mockCurrentUser,
      ui: {
        selectedServerId: "server1",
        perServerSelections: {
          server1: {
            selectedChannelId: "channel1",
            selectedPrivateChatId: null,
          },
        },
        isNarrowView: false,
        isMemberListVisible: false,
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
        mobileViewActiveColumn: "chatView",
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
        settingsNavigation: {},
        shouldFocusChatInput: false,
        pendingBotsModalOpen: null,
        pendingBotCommandPick: null,
        ...defaultUIExtensions,
      },
    });

    vi.clearAllMocks();
  });

  describe("Desktop Mode", () => {
    it("should toggle member list visibility when button is clicked", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          isNarrowView: false,
          isMemberListVisible: false,
        },
      });

      render(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={true}
          isMemberListVisible={false}
          isNarrowView={false}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      const button = screen.getByTestId("toggle-member-list");
      fireEvent.click(button);

      const state = useStore.getState().ui;
      expect(state.isMemberListVisible).toBe(true);
    });

    it("should hide member list when button is clicked again", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          isNarrowView: false,
          isMemberListVisible: true,
        },
      });

      render(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={true}
          isMemberListVisible={true}
          isNarrowView={false}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      const button = screen.getByTestId("toggle-member-list");
      fireEvent.click(button);

      const state = useStore.getState().ui;
      expect(state.isMemberListVisible).toBe(false);
    });
  });

  describe("Narrow View (Mobile)", () => {
    it("should navigate to member list page when button is clicked from chat view", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          isNarrowView: true,
          mobileViewActiveColumn: "chatView",
          isMemberListVisible: false,
        },
      });

      render(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={false}
          isMemberListVisible={false}
          isNarrowView={true}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      const button = screen.getByTestId("toggle-member-list");
      fireEvent.click(button);

      const state = useStore.getState().ui;
      expect(state.mobileViewActiveColumn).toBe("memberList");
    });

    it("should navigate back to chat view when button is clicked from member list page", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          isNarrowView: true,
          mobileViewActiveColumn: "memberList",
          isMemberListVisible: true,
        },
      });

      render(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={false}
          isMemberListVisible={true}
          isNarrowView={true}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      const button = screen.getByTestId("toggle-member-list");
      fireEvent.click(button);

      const state = useStore.getState().ui;
      expect(state.mobileViewActiveColumn).toBe("chatView");
    });

    it("should toggle between chat view and member list multiple times", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          isNarrowView: true,
          mobileViewActiveColumn: "chatView",
          isMemberListVisible: false,
        },
      });

      const { rerender } = render(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={false}
          isMemberListVisible={false}
          isNarrowView={true}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      const button = screen.getByTestId("toggle-member-list");

      // Click 1: chatView -> memberList
      fireEvent.click(button);
      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");

      // Re-render with updated state
      rerender(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={false}
          isMemberListVisible={true}
          isNarrowView={true}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      // Click 2: memberList -> chatView
      fireEvent.click(button);
      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");

      // Re-render with updated state
      rerender(
        <ChatHeader
          selectedChannel={mockChannel}
          selectedPrivateChat={null}
          selectedServerId="server1"
          selectedChannelId="channel1"
          currentUser={mockCurrentUser}
          isChanListVisible={false}
          isMemberListVisible={false}
          isNarrowView={true}
          globalSettings={{ notificationVolume: 0.5 }}
          searchQuery=""
          onToggleChanList={() => {}}
          onToggleMemberList={() => {}}
          onSearchQueryChange={() => {}}
          onToggleNotificationVolume={() => {}}
          onOpenChannelSettings={() => {}}
          onOpenInviteUser={() => {}}
          onOpenBots={() => {}}
        />,
      );

      // Click 3: chatView -> memberList again
      fireEvent.click(button);
      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    });
  });
});
