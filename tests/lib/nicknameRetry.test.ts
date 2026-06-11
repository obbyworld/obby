import { describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";
import { defaultUIExtensions } from "../fixtures/uiState";

describe("Nickname retry functionality", () => {
  it("should retry with underscore when receiving 433 error", () => {
    // Mock the changeNick method
    const changeNickSpy = vi.spyOn(ircClient, "changeNick");

    // Mock the store state with minimal required properties
    const mockState: Partial<AppState> = {
      servers: [
        {
          id: "test-server",
          name: "Test Server",
          host: "test.com",
          port: 6667,
          isConnected: true,
          channels: [
            {
              id: "test-channel",
              name: "#test",
              isPrivate: false,
              serverId: "test-server",
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [],
            },
          ],
          privateChats: [],
          users: [],
        },
      ],
      ui: {
        selectedServerId: "test-server",
        perServerSelections: {
          "test-server": {
            selectedChannelId: "test-channel",
            selectedPrivateChatId: null,
          },
        },
        isNarrowView: false,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: false,
        isMobileMenuOpen: false,
        isMemberListVisible: true,
        isChannelListVisible: true,
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
      addGlobalNotification: vi.fn(),
      appendRawLogLine: vi.fn(),
    };

    // Mock useStore.getState to return our mock state
    vi.spyOn(useStore, "getState").mockReturnValue(mockState as AppState);
    vi.spyOn(useStore, "setState").mockImplementation(() => {});

    // Simulate a 433 error event
    const nickErrorEvent = {
      serverId: "test-server",
      code: "433",
      error: "Nickname already in use",
      nick: "testuser",
      message: "Nickname is already in use",
    };

    // Trigger the NICK_ERROR event
    ircClient.triggerEvent("NICK_ERROR", nickErrorEvent);

    // Verify that changeNick was called with the original nick + underscore
    expect(changeNickSpy).toHaveBeenCalledWith("test-server", "testuser_");

    // Verify that addGlobalNotification was NOT called for 433 errors (since we auto-retry)
    expect(mockState.addGlobalNotification).not.toHaveBeenCalled();

    // Clean up
    changeNickSpy.mockRestore();
  });

  it("should not retry for other error codes", () => {
    // Mock the changeNick method
    const changeNickSpy = vi.spyOn(ircClient, "changeNick");

    // Mock the store state with addGlobalNotification method
    const mockState: Partial<AppState> = {
      servers: [
        {
          id: "test-server",
          name: "Test Server",
          host: "test.com",
          port: 6667,
          isConnected: true,
          channels: [
            {
              id: "test-channel",
              name: "#test",
              isPrivate: false,
              serverId: "test-server",
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [],
            },
          ],
          privateChats: [],
          users: [],
        },
      ],
      ui: {
        selectedServerId: "test-server",
        perServerSelections: {
          "test-server": {
            selectedChannelId: "test-channel",
            selectedPrivateChatId: null,
          },
        },
        isNarrowView: false,
        isAddServerModalOpen: false,
        isEditServerModalOpen: false,
        editServerId: null,
        isSettingsModalOpen: false,
        isQuickActionsOpen: false,
        isDarkMode: false,
        isMobileMenuOpen: false,
        isMemberListVisible: true,
        isChannelListVisible: true,
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
      addGlobalNotification: vi.fn(),
      appendRawLogLine: vi.fn(),
    };

    // Mock useStore methods
    vi.spyOn(useStore, "getState").mockReturnValue(mockState as AppState);
    vi.spyOn(useStore, "setState").mockImplementation(() => {});

    // Simulate a 432 error event (invalid nickname)
    const nickErrorEvent = {
      serverId: "test-server",
      code: "432",
      error: "Invalid nickname",
      nick: "testuser",
      message: "Invalid nickname format",
    };

    // Trigger the NICK_ERROR event
    ircClient.triggerEvent("NICK_ERROR", nickErrorEvent);

    // Verify that changeNick was NOT called for non-433 errors
    expect(changeNickSpy).not.toHaveBeenCalled();

    // Verify that addGlobalNotification WAS called for other error codes
    expect(mockState.addGlobalNotification).toHaveBeenCalledWith({
      type: "fail",
      command: "NICK",
      code: "432",
      message: "Invalid nickname: Invalid nickname format",
      target: "testuser",
      serverId: "test-server",
    });

    // Clean up
    changeNickSpy.mockRestore();
  });
});
