import { act, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelMessageList } from "../../../src/components/layout/ChannelMessageList";
import useStore from "../../../src/store";
import {
  loadNewerMessages,
  loadOlderMessages,
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
  loadOlderMessages: vi.fn(async () => true),
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

describe("ChannelMessageList late history", () => {
  const observers: ResizeObserverCallback[] = [];
  const readRows = (count: number) =>
    Array.from({ length: count }, (_, i) => message(`read-${i}`, i - count));
  const latestObserver = () => observers[observers.length - 2];

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    markerPage.mockReset();
    markerPage.mockReturnValue(new Promise(() => {}));
    vi.mocked(loadOlderMessages).mockReset();
    vi.mocked(loadOlderMessages).mockResolvedValue(true);
    vi.mocked(loadNewerMessages).mockResolvedValue();
    useStore.setState((state) => ({
      servers: [server(false)],
      messages: { [KEY]: readRows(30) },
      historyWindows: {},
      ui: { ...state.ui, isAppFocused: true, isChatAwayFromPresent: false },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the placeholders past the wait while the newest page can still bring unread messages", () => {
    vi.useFakeTimers();
    useStore.setState({ servers: [server(true)] });
    const { container } = render(<ChannelMessageList {...props} />);

    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector(".sticky")).not.toBeNull();
    expect(isAwayFromPresent()).toBe(true);

    act(() =>
      useStore.setState({
        servers: [server(false)],
        messages: { [KEY]: [...readRows(30), message("new-1", 5)] },
      }),
    );
    expect(container.querySelector(".sticky")).toBeNull();
    expect(container.querySelector("[data-unread-line]")).not.toBeNull();
  });

  it("waits in a window until the messages after the line arrive", () => {
    vi.useFakeTimers();
    useStore.setState({
      messages: { [KEY]: [...readRows(30), message("new-1", 5)] },
      historyWindows: {
        [KEY]: { until: Date.parse(at(5)), present: [], jumpId: 1 },
      },
    });
    const { container } = render(<ChannelMessageList {...props} />);
    expect(container.querySelector(".sticky")).not.toBeNull();

    act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector(".sticky")).toBeNull();
  });

  it("keeps the reading position when an older page lands after the wait", () => {
    vi.useFakeTimers();
    const { container } = render(<ChannelMessageList {...props} />);
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 0);
    fireEvent.scroll(list);
    expect(loadOlderMessages).toHaveBeenCalled();
    act(() => useStore.setState({ servers: [server(true)] }));

    act(() => vi.advanceTimersByTime(11_000));
    act(() =>
      useStore.setState({
        servers: [server(false)],
        messages: { [KEY]: [message("older", -60), ...readRows(30)] },
      }),
    );

    expect(list.scrollTop).toBe(0);
  });

  it("keeps the new messages line where it opened when rows land above it", () => {
    const unread = Array.from({ length: 30 }, (_, i) =>
      message(`new-${i}`, i + 1),
    );
    useStore.setState({
      servers: [server(true)],
      messages: { [KEY]: [...readRows(30), ...unread] },
    });
    const { container } = render(<ChannelMessageList {...props} />);
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 0, 3000);
    const line = list.querySelector("[data-unread-line]") as HTMLElement;
    line.getBoundingClientRect = () => ({ top: 1000 }) as DOMRect;
    act(() => useStore.setState({ servers: [server(false)] }));
    expect(list.scrollTop).toBe(952);

    Object.defineProperty(line, "offsetTop", {
      configurable: true,
      value: 500,
    });
    observers[observers.length - 1]([], {} as ResizeObserver);

    expect(list.scrollTop).toBe(1452);
  });

  it("loads older pages around a held row while placeholders show above it", () => {
    const { container } = render(<ChannelMessageList {...props} />);
    act(() => useStore.getState().revealMessage("read-20"));
    vi.mocked(loadOlderMessages).mockClear();
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 0);
    const skeleton = list.querySelector('[aria-hidden="true"]') as HTMLElement;
    skeleton.getBoundingClientRect = () => ({ bottom: 200 }) as DOMRect;

    fireEvent.scroll(list);

    expect(loadOlderMessages).toHaveBeenCalled();
  });

  it("follows the end of a list that shrank", () => {
    const { container } = render(<ChannelMessageList {...props} />);
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 400, 1000);
    latestObserver()([], {} as ResizeObserver);

    setGeometry(list, 200, 800);
    latestObserver()([], {} as ResizeObserver);

    expect(list.scrollTop).toBe(800);
  });

  it("follows the end when the list grows as loading restarts the size watch", () => {
    const { container } = render(<ChannelMessageList {...props} />);
    const list = container.firstElementChild as HTMLElement;
    setGeometry(list, 400, 1000);
    latestObserver()([], {} as ResizeObserver);

    setGeometry(list, 400, 1150);
    act(() => useStore.setState({ servers: [server(true)] }));
    observers[observers.length - 1]([], {} as ResizeObserver);

    expect(list.scrollTop).toBe(1150);
  });
});
