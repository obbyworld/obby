import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LinkSecurityWarningModal from "../../src/components/ui/LinkSecurityWarningModal";

// Mock the store
vi.mock("../../src/store", () => {
  const mockStoreFn = vi.fn();
  const mockGetState = vi.fn();
  const mockSetState = vi.fn();
  return {
    default: Object.assign(mockStoreFn, {
      getState: mockGetState,
      setState: mockSetState,
    }),
    loadSavedServers: vi.fn(),
    saveServersToLocalStorage: vi.fn(),
  };
});

// Get references to the mocked functions
import useStore, {
  loadSavedServers,
  saveServersToLocalStorage,
} from "../../src/store";

const mockStore = vi.mocked(useStore);
const mockGetState = vi.mocked(useStore.getState);
const mockSetState = vi.mocked(useStore.setState);
const mockLoadSavedServers = vi.mocked(loadSavedServers);
const mockSaveServersToLocalStorage = vi.mocked(saveServersToLocalStorage);

// Mock IRC client
vi.mock("../../src/lib/ircClient", () => ({
  default: {
    sendRaw: vi.fn(),
    sendCapEnd: vi.fn(),
    userOnConnect: vi.fn(),
  },
}));

// Mock Audio
const mockPlay = vi.fn();
global.Audio = vi.fn().mockImplementation(() => ({
  play: mockPlay,
  volume: 0,
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe("LinkSecurityWarningModal", () => {
  // biome-ignore lint/suspicious/noExplicitAny: Test mock state doesn't need full typing
  let mockState: any;

  beforeEach(() => {
    mockState = {
      servers: [
        {
          id: "server1",
          name: "Test Server",
          host: "irc.example.com",
          port: 6667,
          linkSecurity: 1,
        },
        {
          id: "server2",
          name: "Local Server",
          host: "localhost",
          port: 6667,
          linkSecurity: 0,
        },
        // biome-ignore lint/suspicious/noExplicitAny: Partial mock doesn't need full Server type
      ] as any[], // Cast to any to avoid full Server type
      ui: {
        linkSecurityWarnings: [
          { serverId: "server1", timestamp: Date.now() },
          { serverId: "server2", timestamp: Date.now() },
        ],
        selectedServerId: null,
        selectedChannelId: null,
        selectedPrivateChatId: null,
        isAddServerModalOpen: false,
        isSettingsModalOpen: false,
        isUserProfileModalOpen: false,
        isDarkMode: false,
        isMobileMenuOpen: false,
        isMemberListVisible: false,
        isChannelListVisible: false,
        isChannelListModalOpen: false,
        // biome-ignore lint/suspicious/noExplicitAny: Partial mock type
        mobileViewActiveColumn: "chat" as any,
        isServerMenuOpen: false,
        contextMenu: {
          isOpen: false,
          x: 0,
          y: 0,
          // biome-ignore lint/suspicious/noExplicitAny: Partial mock type
          type: "server" as any,
          itemId: null,
        },
        prefillServerDetails: null,
        inputAttachments: [],
        isServerNoticesPopupOpen: false,
        serverNoticesPopupMinimized: false,
      },
      disconnect: vi.fn(),
      currentUser: null,
      isConnecting: false,
      selectedServerId: null,
      connectionError: null,
      messages: {},
      typingUsers: {},
      globalNotifications: [],
      channelList: {},
      channelListBuffer: {},
      channelListFilters: {},
      listingInProgress: {},
      metadataSubscriptions: {},
      metadataBatches: {},
      privateChats: [],
      ignoredUsers: [],
      globalSettings: {
        enableNotifications: true,
        notificationSound: "default",
        notificationVolume: 0.8,
        skipLinkSecurityWarnings: false,
      },
    };

    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set up default mock for each test - mockStore should handle selectors
    mockStore.mockImplementation((selector) => {
      if (typeof selector === "function") {
        // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
        return selector(mockState as any);
      }
      // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
      return mockState as any;
    });

    // Mock getState to return the state
    // biome-ignore lint/suspicious/noExplicitAny: Mock function typing and state don't need full typing
    (mockStore.getState as any).mockReturnValue(mockState as any);
    mockSetState.mockImplementation((updater) => {
      if (typeof updater === "function") {
        // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
        Object.assign(mockState, updater(mockState as any));
      } else {
        Object.assign(mockState, updater);
      }
    });

    mockLoadSavedServers.mockReturnValue([
      {
        id: "server1",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        nickname: "testuser",
        channels: [],
        saslEnabled: false,
      },
      {
        id: "server2",
        name: "Local Server",
        host: "localhost",
        port: 6667,
        nickname: "testuser",
        channels: [],
        saslEnabled: false,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders multiple warning modals", () => {
    render(<LinkSecurityWarningModal />);

    const securityWarnings = screen.getAllByText("Security Warning");
    expect(securityWarnings).toHaveLength(2);
    expect(screen.getByText("Test Server")).toBeInTheDocument();
    expect(screen.getByText("Local Server")).toBeInTheDocument();
  });

  test("renders link security warning correctly", () => {
    render(<LinkSecurityWarningModal />);

    expect(screen.getByText("Test Server")).toBeInTheDocument();
    expect(screen.getByText("Low Link Security (Level 1)")).toBeInTheDocument();
    // There are 2 modals, each with their own checkbox
    expect(
      screen.getAllByText(
        "Don't warn me about low link security for this server",
      ),
    ).toHaveLength(2);
  });

  test("continue button is disabled until timer expires and scrolled to bottom", () => {
    render(<LinkSecurityWarningModal />);

    // Find buttons containing "Please wait..." text
    const buttons = screen.getAllByRole("button");
    const waitButtons = buttons.filter((button) =>
      button.textContent?.includes("Please wait..."),
    );
    expect(waitButtons.length).toBeGreaterThan(0);
    waitButtons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  test("handles cancel connection", () => {
    const mockDisconnect = vi.fn();
    // Create a fresh state for this test
    const testState = {
      ...mockState,
      disconnect: mockDisconnect,
    };

    // Override mocks for this test
    mockStore.mockImplementation((selector) => {
      if (typeof selector === "function") {
        // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
        return selector(testState as any);
      }
      // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
      return testState as any;
    });
    // biome-ignore lint/suspicious/noExplicitAny: Mock function typing and state don't need full typing
    (mockStore.getState as any).mockReturnValue(testState as any);
    mockSetState.mockImplementation((updater) => {
      if (typeof updater === "function") {
        // biome-ignore lint/suspicious/noExplicitAny: Mock state doesn't need full typing
        Object.assign(testState, updater(testState as any));
      } else {
        Object.assign(testState, updater);
      }
    });

    render(<LinkSecurityWarningModal />);

    const cancelButtons = screen.getAllByText("Cancel Connection");
    if (cancelButtons.length > 0) {
      fireEvent.click(cancelButtons[0]);
    }

    expect(mockDisconnect).toHaveBeenCalledWith("server1");
  });

  test("prevents clicking away from modal", () => {
    render(<LinkSecurityWarningModal />);

    const backdrops = screen.getAllByText("Security Warning");
    if (backdrops.length > 0) {
      const backdrop = backdrops[0].closest(".fixed");
      if (backdrop) {
        fireEvent.click(backdrop);
      }
    }

    // Modal should still be visible
    expect(screen.getAllByText("Security Warning")).toHaveLength(2);
    // Audio should have been attempted
    expect(mockPlay).toHaveBeenCalled();
  });

  test("renders server name correctly", () => {
    render(<LinkSecurityWarningModal />);

    expect(screen.getByText("Test Server")).toBeInTheDocument();
    expect(screen.getByText("Local Server")).toBeInTheDocument();
  });

  test("saves checkbox preferences to localStorage", async () => {
    // Mock timer and scroll state
    vi.useFakeTimers();

    const mockSavedServers = [
      {
        id: "server1",
        host: "irc.example.com",
        port: 6667,
        nickname: "testuser",
        saslEnabled: false,
        channels: [],
      },
      {
        id: "server2",
        host: "localhost",
        port: 6667,
        nickname: "testuser",
        saslEnabled: false,
        channels: [],
      },
    ];

    mockLoadSavedServers.mockReturnValue(mockSavedServers);
    mockSaveServersToLocalStorage.mockClear();

    render(<LinkSecurityWarningModal />);

    // Find and check the "Don't warn me about low link security" checkbox for server1
    const linkSecurityCheckboxes = screen.getAllByText(
      "Don't warn me about low link security for this server",
    );
    const linkSecurityCheckbox = linkSecurityCheckboxes[0]
      .previousElementSibling as HTMLInputElement;

    // Check the checkbox
    act(() => {
      fireEvent.click(linkSecurityCheckbox);
    });

    expect(linkSecurityCheckbox.checked).toBe(true);

    // Fast-forward timer
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Mock scroll to bottom
    const scrollContainers = document.querySelectorAll(".overflow-y-auto");
    if (scrollContainers.length > 0) {
      const container = scrollContainers[0] as HTMLElement;
      Object.defineProperty(container, "scrollHeight", {
        value: 1000,
        writable: true,
      });
      Object.defineProperty(container, "clientHeight", {
        value: 500,
        writable: true,
      });
      Object.defineProperty(container, "scrollTop", {
        value: 500,
        writable: true,
      });

      act(() => {
        fireEvent.scroll(container);
      });
    }

    // Find and click continue button
    const continueButtons = screen.getAllByText(/Continue Anyway/);
    if (continueButtons.length > 0) {
      act(() => {
        fireEvent.click(continueButtons[0]);
      });

      // Verify saveServersToLocalStorage was called with updated server config
      expect(mockSaveServersToLocalStorage).toHaveBeenCalled();
      const savedServers = mockSaveServersToLocalStorage.mock.calls[0][0];
      // biome-ignore lint/suspicious/noExplicitAny: Mock server config doesn't need full typing
      const updatedServer = savedServers.find((s: any) => s.id === "server1");
      expect(updatedServer?.skipLinkSecurityWarning).toBe(true);
    }

    vi.useRealTimers();
  });
});
