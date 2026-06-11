import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../../src/components/layout/AppLayout";
import useStore from "../../../src/store";
import { defaultUIExtensions } from "../../fixtures/uiState";

describe("AppLayout - Resize Behavior", () => {
  let matchMediaMock: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    matchMediaMock = {
      matches: false,
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
        isNarrowView: false,
        mobileViewActiveColumn: "serverList",
        isChannelListVisible: true,
        isMemberListVisible: true,
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

  it("should initialize with desktop state when matches is false", () => {
    render(<AppLayout />);

    const state = useStore.getState().ui;
    expect(state.isNarrowView).toBe(false);
  });

  it("should initialize with mobile state when matches is true", () => {
    matchMediaMock.matches = true;
    useStore.setState({
      ui: {
        ...useStore.getState().ui,
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
      },
    });

    render(<AppLayout />);

    const state = useStore.getState().ui;
    expect(state.isNarrowView).toBe(true);
    expect(state.mobileViewActiveColumn).toBe("serverList");
  });

  it("should call setIsNarrowView action correctly for mobile→desktop transition", () => {
    const { setIsNarrowView } = useStore.getState();

    useStore.setState({
      ui: {
        ...useStore.getState().ui,
        isNarrowView: true,
        mobileViewActiveColumn: "chatView",
        isChannelListVisible: false,
        isMemberListVisible: false,
      },
    });

    setIsNarrowView(false);

    const state = useStore.getState().ui;
    expect(state.isNarrowView).toBe(false);
    expect(state.isChannelListVisible).toBe(true);
  });

  it("should call setIsNarrowView action correctly for desktop→mobile transition", () => {
    const { setIsNarrowView } = useStore.getState();

    setIsNarrowView(true);

    const state = useStore.getState().ui;
    expect(state.isNarrowView).toBe(true);
    expect(state.mobileViewActiveColumn).toBe("serverList");
  });

  it("should not create halfway states during transition", () => {
    render(<AppLayout />);

    const state = useStore.getState().ui;

    if (state.isNarrowView) {
      expect(state.mobileViewActiveColumn).toBeTruthy();
    } else {
      expect(state.isChannelListVisible).toBe(true);
    }
  });

  it("should maintain state consistency with setIsNarrowView", () => {
    const { setIsNarrowView } = useStore.getState();

    setIsNarrowView(true);
    const mobileState = useStore.getState().ui;
    expect(mobileState.isNarrowView).toBe(true);
    expect(mobileState.mobileViewActiveColumn).toBeTruthy();

    setIsNarrowView(false);
    const desktopState = useStore.getState().ui;
    expect(desktopState.isNarrowView).toBe(false);
    expect(desktopState.isChannelListVisible).toBe(true);
  });

  it("should navigate to chatView when resizing from desktop to mobile with active channel", () => {
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
        isNarrowView: false,
        selectedServerId: "server1",
        mobileViewActiveColumn: "serverList",
        isChannelListVisible: true,
        perServerSelections: {
          server1: {
            selectedChannelId: "#test",
            selectedPrivateChatId: null,
          },
        },
      },
    });

    expect(useStore.getState().ui.isNarrowView).toBe(false);

    const { setIsNarrowView } = useStore.getState();
    setIsNarrowView(true);

    const state = useStore.getState().ui;
    expect(state.isNarrowView).toBe(true);
    expect(state.mobileViewActiveColumn).toBe("chatView");
  });
});
