import { act, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelMessageList } from "../../../src/components/layout/ChannelMessageList";
import useStore from "../../../src/store";
import {
  loadNewerMessages,
  showMessagesFromReadMarker,
} from "../../../src/store/handlers/history";
import type { Message, Server } from "../../../src/types";

vi.mock("../../../src/lib/ircClient", () => ({
  default: {
    sendRaw: vi.fn(),
    isChannel: (_serverId: string, name?: string) =>
      !!name && "#&+!^$".includes(name[0]),
    on: vi.fn(),
    getCurrentUser: vi.fn(() => ({ id: "u1", username: "tester" })),
    getNick: vi.fn(() => "tester"),
    version: "1.0.0",
  },
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

vi.mock("../../../src/store/handlers/history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/store/handlers/history")
  >()),
  showMessagesFromReadMarker: vi.fn(),
  loadNewerMessages: vi.fn(),
}));

const KEY = "s1-pm1";
const at = (minute: number) =>
  new Date(Date.UTC(2024, 0, 1, 12, minute)).toISOString();
const message = (id: string, minute: number): Message => ({
  id,
  msgid: id,
  type: "message",
  content: id,
  timestamp: new Date(at(minute)),
  userId: "alice",
  channelId: "pm1",
  serverId: "s1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
});

const server = (isLoadingHistory: boolean) =>
  ({
    id: "s1",
    name: "s1",
    host: "irc.example",
    port: 6697,
    isConnected: true,
    capabilities: ["draft/read-marker"],
    channels: [],
    users: [],
    privateChats: [
      {
        id: "pm1",
        username: "alice",
        serverId: "s1",
        unreadCount: 0,
        isMentioned: false,
        readMarker: at(0),
        hasMoreHistory: true,
        isLoadingHistory,
      },
    ],
  }) as unknown as Server;

const props = {
  channelKey: KEY,
  serverId: "s1",
  channelId: null,
  privateChatId: "pm1",
  isActive: true,
  isMemberListVisible: false,
  onReply: vi.fn(),
  onUsernameContextMenu: vi.fn(),
  onIrcLinkClick: vi.fn(),
  onReactClick: vi.fn(),
  onReactionUnreact: vi.fn(),
  onOpenReactionModal: vi.fn(),
  onDirectReaction: vi.fn(),
  onRedactMessage: vi.fn(),
  onOpenProfile: vi.fn(),
  joinChannel: vi.fn(),
};

const markerPage = vi.mocked(showMessagesFromReadMarker);
const isAwayFromPresent = () => useStore.getState().ui.isChatAwayFromPresent;
const setGeometry = (
  list: HTMLElement,
  scrollTop: number,
  scrollHeight = 1000,
) => {
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(list, "scrollTop", {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
};

describe("ChannelMessageList opening on the read marker", () => {
  beforeEach(() => {
    markerPage.mockReset();
    markerPage.mockReturnValue(new Promise(() => {}));
    useStore.setState((state) => ({
      servers: [server(false)],
      messages: { [KEY]: [message("new-1", 5), message("new-2", 6)] },
      historyWindows: {},
      ui: { ...state.ui, isAppFocused: true, isChatAwayFromPresent: false },
    }));
  });

  afterEach(() => vi.useRealTimers());

  it("asks for the marker page once, even when React runs effects twice", () => {
    render(
      <StrictMode>
        <ChannelMessageList {...props} />
      </StrictMode>,
    );

    expect(markerPage).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting for a late marker page and leaves the unread messages unread", () => {
    vi.useFakeTimers();
    useStore.setState({ servers: [server(true)] });
    const { container } = render(<ChannelMessageList {...props} />);
    expect(markerPage).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(4000));
    expect(markerPage).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(isAwayFromPresent()).toBe(true);
    expect(container.querySelector(".sticky")).not.toBeNull();
  });

  it("drops a marker page that lands after the user went to the bottom", () => {
    const { container, getByRole } = render(<ChannelMessageList {...props} />);
    const isCurrent = markerPage.mock.calls[0][4] as () => boolean;
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 0);
    fireEvent.scroll(list);

    fireEvent.click(getByRole("button", { name: "Scroll to bottom" }));

    expect(isCurrent()).toBe(false);
    expect(container.querySelector(".sticky")).toBeNull();
  });
});

describe("ChannelMessageList window below a held row", () => {
  it("loads newer rows while the row is held", () => {
    vi.mocked(loadNewerMessages).mockResolvedValue();
    const rows = Array.from({ length: 20 }, (_, i) => message(`old-${i}`, i));
    useStore.setState((state) => ({
      servers: [server(false)],
      messages: { [KEY]: rows },
      historyWindows: {
        [KEY]: { until: Date.parse(at(19)), present: [], jumpId: 1 },
      },
      ui: { ...state.ui, isAppFocused: true },
    }));
    const { container } = render(<ChannelMessageList {...props} />);
    act(() => useStore.getState().revealMessage("old-10"));
    vi.mocked(loadNewerMessages).mockClear();

    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 300);
    fireEvent.scroll(list);

    expect(loadNewerMessages).toHaveBeenCalledWith(useStore, "s1", "alice");
  });
});
