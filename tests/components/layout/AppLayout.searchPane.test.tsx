import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../../src/components/layout/AppLayout";
import useStore from "../../../src/store";
import type { Server } from "../../../src/types";
import { defaultUIExtensions } from "../../fixtures/uiState";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "android"),
}));

vi.mock("../../../src/lib/platformUtils", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauriAndroid: () => true,
}));

vi.mock("../../../src/store/handlers/history", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchSavedMessages: vi.fn(() => Promise.resolve({ hits: [] })),
}));

const PANE_INPUT = "Search messages, filter with from: in: has:link";

const server: Server = {
  id: "server1",
  name: "TestNet",
  host: "irc.test",
  port: 6667,
  isConnected: true,
  users: [],
  channels: [
    {
      id: "channel1",
      name: "#general",
      isPrivate: false,
      serverId: "server1",
      unreadCount: 0,
      isMentioned: false,
      messages: [],
      users: [],
    },
  ],
  privateChats: [],
};

type Mode = "desktop" | "overlay" | "mobile";

function setMode(mode: Mode) {
  const matching: Record<Mode, string[]> = {
    desktop: [],
    overlay: ["(max-width: 1080px)"],
    mobile: ["(max-width: 768px)", "(max-width: 1080px)"],
  };
  window.matchMedia = vi.fn((query: string) => ({
    matches: matching[mode].includes(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  useStore.setState({
    servers: [server],
    messages: {},
    ui: {
      selectedServerId: "server1",
      perServerSelections: {
        server1: { selectedChannelId: "channel1", selectedPrivateChatId: null },
      },
      isNarrowView: mode === "mobile",
      isMemberListVisible: false,
      isChannelListVisible: true,
      isAddServerModalOpen: false,
      quickActions: null,
      isDarkMode: true,
      isMobileMenuOpen: false,
      linkSecurityWarnings: [],
      mobileViewActiveColumn: "chatView",
      isServerMenuOpen: false,
      contextMenu: { isOpen: false, x: 0, y: 0, type: "server", itemId: null },
      prefillServerDetails: null,
      inputAttachments: [],
      isServerNoticesPopupOpen: false,
      serverNoticesPopupMinimized: false,
      shouldFocusChatInput: false,
      pendingBotCommandPick: null,
      pendingComposerCommand: null,
      ...defaultUIExtensions,
    },
  } as never);
}

const openResults = () =>
  act(() =>
    useStore.getState().openSearchResults({
      text: "deploy",
      scope: { kind: "everywhere" },
    }),
  );

const renderLayout = () =>
  render(
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>,
  );

const paneInput = () => screen.queryByRole("combobox", { name: PANE_INPUT });

describe("AppLayout search results pane", () => {
  beforeEach(() => {
    window.androidBackCallback = undefined;
  });

  it("shows the results in the right sidebar on a wide window", () => {
    setMode("desktop");
    renderLayout();
    openResults();

    expect(paneInput()).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show search results" }),
    ).not.toBeInTheDocument();
  });

  it("covers the chat at narrow desktop widths and steps aside for a result", () => {
    setMode("overlay");
    renderLayout();
    openResults();
    const isPaneHidden = () => !!paneInput()?.closest(".hidden");
    expect(isPaneHidden()).toBe(false);

    act(() => useStore.getState().setSearchChatShown(true));
    expect(isPaneHidden()).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Show search results" }),
    );
    expect(isPaneHidden()).toBe(false);
  });

  it("opens the results as their own page on phones", () => {
    setMode("mobile");
    renderLayout();
    openResults();

    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    expect(
      paneInput()
        ?.closest("[data-swipe-page]")
        ?.getAttribute("data-swipe-page"),
    ).toBe("memberList");
  });

  it("goes back from a result to the results, then closes them on Android back", () => {
    setMode("mobile");
    renderLayout();
    openResults();
    act(() => useStore.getState().setSearchChatShown(true));
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");

    act(() => {
      window.androidBackCallback?.();
    });
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    expect(useStore.getState().ui.sidePane?.kind).toBe("search");

    act(() => {
      window.androidBackCallback?.();
    });
    expect(useStore.getState().ui.sidePane).toBeNull();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
  });

  it("returns to the chat from the back chevron on phones", () => {
    setMode("mobile");
    renderLayout();
    openResults();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(useStore.getState().ui.sidePane).toBeNull();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
  });

  it("hides the way back once another chat opens, and closes from its X", () => {
    setMode("overlay");
    renderLayout();
    openResults();
    act(() => useStore.getState().setSearchChatShown(true));
    const backBar = () =>
      screen.queryByRole("button", { name: "Show search results" });
    expect(backBar()).toBeInTheDocument();

    act(() =>
      useStore.setState((state) => ({
        ui: {
          ...state.ui,
          perServerSelections: {
            server1: {
              selectedChannelId: "other",
              selectedPrivateChatId: null,
            },
          },
        },
      })),
    );
    expect(backBar()).not.toBeInTheDocument();

    act(() =>
      useStore.setState((state) => ({
        ui: {
          ...state.ui,
          perServerSelections: {
            server1: {
              selectedChannelId: "channel1",
              selectedPrivateChatId: null,
            },
          },
        },
      })),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Close search" })[0]);
    expect(useStore.getState().ui.sidePane).toBeNull();
  });
});
