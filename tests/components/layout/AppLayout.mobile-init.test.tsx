import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../../src/components/layout/AppLayout";
import useStore from "../../../src/store";
import { defaultUIExtensions } from "../../fixtures/uiState";

describe("AppLayout - Mobile Initial Load", () => {
  let matchMediaMock: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    matchMediaMock = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(
      () => matchMediaMock as unknown as MediaQueryList,
    );

    useStore.setState({
      servers: [],
      ui: {
        selectedServerId: null,
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
        isChannelListVisible: false,
        isMemberListVisible: false,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: true,
        isMobileMenuOpen: false,
        isChannelListModalOpen: false,
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
        linkSecurityWarnings: [],
        isServerNoticesPopupOpen: false,
        serverNoticesPopupMinimized: false,
        profileViewRequest: null,
        settingsNavigation: {},
        perServerSelections: {},
        shouldFocusChatInput: false,
        pendingBotsModalOpen: null,
        pendingBotCommandPick: null,
        ...defaultUIExtensions,
      },
    });
  });

  it("should stay on serverList when loading on mobile with saved server", () => {
    useStore.setState({
      servers: [
        {
          id: "server1",
          name: "Test Server",
          host: "irc.test.com",
          port: 6697,
          channels: [
            {
              id: "server1-#test",
              name: "#test",
              topic: "",
              users: [],
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              isPrivate: false,
              serverId: "server1",
              metadata: {},
            },
          ],
          privateChats: [],
          users: [],
          isConnected: true,
          connectionState: "connected",
        },
      ],
      ui: {
        ...useStore.getState().ui,
        selectedServerId: "server1",
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
        perServerSelections: {
          server1: {
            selectedChannelId: "#test",
            selectedPrivateChatId: null,
          },
        },
      },
    });

    render(<AppLayout />);

    const state = useStore.getState().ui;
    expect(state.mobileViewActiveColumn).toBe("serverList");
  });

  it("should stay on serverList even when channel is selected", () => {
    useStore.setState({
      servers: [
        {
          id: "server1",
          name: "Test Server",
          host: "irc.test.com",
          port: 6697,
          channels: [
            {
              id: "server1-#lobby",
              name: "#lobby",
              topic: "",
              users: [],
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              isPrivate: false,
              serverId: "server1",
              metadata: {},
            },
          ],
          privateChats: [],
          users: [],
          isConnected: true,
          connectionState: "connected",
        },
      ],
      ui: {
        ...useStore.getState().ui,
        selectedServerId: "server1",
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
        perServerSelections: {
          server1: {
            selectedChannelId: "#lobby",
            selectedPrivateChatId: null,
          },
        },
      },
    });

    render(<AppLayout />);

    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
  });

  it("should not change mobileViewActiveColumn on initial mount with no server", () => {
    useStore.setState({
      servers: [],
      ui: {
        ...useStore.getState().ui,
        selectedServerId: null,
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
      },
    });

    render(<AppLayout />);

    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
  });
});
