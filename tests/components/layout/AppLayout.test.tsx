import { act, fireEvent, render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../../src/components/layout/AppLayout";
import useStore from "../../../src/store";
import type { Channel, Server, User } from "../../../src/types";
import { defaultUIExtensions } from "../../fixtures/uiState";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "linux"),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: query === "(max-width: 768px)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockUsers: User[] = [
  { id: "1", username: "alice", isOnline: true },
  { id: "2", username: "bob", isOnline: true },
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

const renderAppLayout = () => {
  return render(
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>,
  );
};

const createTouchEvent = (
  type: string,
  clientX: number,
  clientY: number,
): TouchEvent => {
  const touch = {
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pageX: clientX,
    pageY: clientY,
    identifier: 0,
    target: document.createElement("div"),
    force: 0,
    radiusX: 0,
    radiusY: 0,
    rotationAngle: 0,
  } as unknown as Touch;

  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type !== "touchend" ? [touch] : [],
    targetTouches: type !== "touchend" ? [touch] : [],
    changedTouches: [touch],
  });
};

describe("AppLayout Swipe Navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
        isNarrowView: true, // Mobile view test
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
      messages: {},
      isConnecting: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("Mobile view (narrow screen)", () => {
    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: query === "(max-width: 768px)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    it("should start on serverList page", () => {
      renderAppLayout();
      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
    });

    it("should change to chatView when swiping left", () => {
      renderAppLayout();
      const container = document.querySelector(
        ".relative.w-full.h-full.overflow-hidden",
      );
      expect(container).toBeTruthy();

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchstart", 200, 100),
        );
      });

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchmove", 100, 100),
        );
      });

      act(() => {
        fireEvent(container as Element, createTouchEvent("touchend", 100, 100));
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
    });

    it("should change to memberList when swiping left from chatView", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          mobileViewActiveColumn: "chatView",
        },
      });

      renderAppLayout();
      const container = document.querySelector(
        ".relative.w-full.h-full.overflow-hidden",
      );

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchstart", 200, 100),
        );
      });

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchmove", 100, 100),
        );
      });

      act(() => {
        fireEvent(container as Element, createTouchEvent("touchend", 100, 100));
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    });

    it("should go back to chatView when swiping right from memberList", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          mobileViewActiveColumn: "memberList",
          isMemberListVisible: true,
        },
      });

      renderAppLayout();
      const container = document.querySelector(
        ".relative.w-full.h-full.overflow-hidden",
      );

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchmove", 200, 100),
        );
      });

      act(() => {
        fireEvent(container as Element, createTouchEvent("touchend", 200, 100));
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
    });

    it("should not change page when swipe is below threshold", () => {
      renderAppLayout();
      const container = document.querySelector(
        ".relative.w-full.h-full.overflow-hidden",
      );

      const initialColumn = useStore.getState().ui.mobileViewActiveColumn;

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        fireEvent(
          container as Element,
          createTouchEvent("touchmove", 120, 100),
        );
      });

      act(() => {
        fireEvent(container as Element, createTouchEvent("touchend", 120, 100));
      });

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe(initialColumn);
    });

    it("should have 3 pages when server is selected", () => {
      renderAppLayout();
      const pages = document.querySelectorAll("[data-swipe-page]");
      expect(pages.length).toBe(3);
    });

    it("should have 2 pages when no server is selected", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          selectedServerId: null,
        },
      });

      renderAppLayout();
      const pages = document.querySelectorAll("[data-swipe-page]");
      expect(pages.length).toBe(2);
    });
  });

  describe("Desktop view (wide screen)", () => {
    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: query !== "(max-width: 768px)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    it("should not render swipe container on desktop", () => {
      renderAppLayout();
      const swipeContainer = document.querySelector(
        ".relative.w-full.h-full.overflow-hidden",
      );
      expect(swipeContainer).toBeFalsy();
    });

    it("should render all columns side by side", () => {
      renderAppLayout();
      const serverList = document.querySelector(".server-list");
      const channelList = document.querySelector(".channel-list");
      expect(serverList).toBeTruthy();
      expect(channelList).toBeTruthy();
    });
  });

  describe("Android back button", () => {
    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: query === "(max-width: 768px)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      Object.defineProperty(window, "__TAURI__", {
        value: true,
        writable: true,
      });

      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
        writable: true,
        configurable: true,
      });
    });

    it("should navigate from chatView to serverList on back", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          mobileViewActiveColumn: "chatView",
        },
      });

      renderAppLayout();

      const result = window.androidBackCallback?.();

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
      expect(result).toBe(false);
    });

    it("should navigate from memberList to chatView on back", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          mobileViewActiveColumn: "memberList",
          isMemberListVisible: true,
        },
      });

      renderAppLayout();

      const result = window.androidBackCallback?.();

      expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
      expect(result).toBe(false);
    });

    it("should allow app exit from serverList on back", () => {
      useStore.setState({
        ui: {
          ...useStore.getState().ui,
          mobileViewActiveColumn: "serverList",
        },
      });

      renderAppLayout();

      const result = window.androidBackCallback?.();

      expect(result).toBe(true);
    });
  });
});
