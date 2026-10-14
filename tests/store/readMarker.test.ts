import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/store";
import type { Message } from "../../src/types";

vi.mock("../../src/lib/notificationSounds", () => ({
  playNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => false),
}));

const SERVER = "srv";
const KEY = `${SERVER}-chan-1`;
const BASE = Date.parse("2026-01-01T12:00:00.000Z");

const message = (index: number, userId = "alice"): Message =>
  ({
    id: `m${index}`,
    msgid: `m${index}`,
    type: "message",
    content: `line ${index}`,
    timestamp: new Date(BASE + index * 1000),
    userId,
    channelId: "chan-1",
    serverId: SERVER,
    reactions: [],
    replyMessage: null,
    mentioned: [],
  }) as Message;

async function boot({
  selected,
  readMarker = new Date(BASE + 1000).toISOString(),
}: {
  selected: boolean;
  readMarker?: string;
}) {
  vi.resetModules();
  const { default: useStore } = await import("../../src/store");
  const { default: ircClient } = await import("../../src/lib/ircClient");
  const helpers = await import("../../src/store/helpers");
  vi.spyOn(ircClient, "getCurrentUser").mockReturnValue({
    id: "tester",
    username: "tester",
    account: "tester",
    isOnline: true,
  });
  vi.spyOn(ircClient, "getNick").mockReturnValue("tester");
  const markreadSet = vi
    .spyOn(ircClient, "markreadSet")
    .mockImplementation(() => {});
  useStore.setState(
    (state) =>
      ({
        servers: [
          {
            id: SERVER,
            name: "TestNet",
            host: "irc.test",
            port: 6667,
            isConnected: true,
            capabilities: ["draft/read-marker"],
            privateChats: [],
            channels: [
              {
                id: "chan-1",
                name: "#chan",
                isPrivate: false,
                serverId: SERVER,
                unreadCount: 3,
                readMarker,
                mentionCount: 1,
                isMentioned: true,
                messages: [],
                users: [],
              },
            ],
          },
        ],
        messages: { [KEY]: [message(1), message(2), message(3)] },
        ui: {
          ...state.ui,
          isNarrowView: false,
          selectedServerId: selected ? SERVER : null,
          perServerSelections: {
            [SERVER]: {
              selectedChannelId: selected ? "chan-1" : null,
              selectedPrivateChatId: null,
            },
          },
        },
      }) as unknown as AppState,
  );
  const channel = () => useStore.getState().servers[0].channels[0];
  return { useStore, ircClient, helpers, markreadSet, channel };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("read markers", () => {
  it("puts the new messages line above the first message from someone else after the marker", async () => {
    const { helpers } = await boot({ selected: false });
    const messages = [message(1), message(2, "tester"), message(3)];
    expect(helpers.firstUnreadMessageId(messages, BASE + 1000, "Tester")).toBe(
      "m3",
    );
    expect(
      helpers.firstUnreadMessageId(messages, BASE + 3000, "tester"),
    ).toBeUndefined();
  });

  it("clears unread and mentions once another client read past the newest message", async () => {
    const { ircClient, channel } = await boot({ selected: false });
    ircClient.triggerEvent("MARKREAD", {
      serverId: SERVER,
      target: "#chan",
      timestamp: new Date(BASE + 2000).toISOString(),
    });
    expect(channel().unreadCount).toBe(1);
    ircClient.triggerEvent("MARKREAD", {
      serverId: SERVER,
      target: "#CHAN",
      timestamp: new Date(BASE + 3000).toISOString(),
    });
    expect(channel()).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      isMentioned: false,
    });
  });

  it("marks the chat read up to its newest message once the user sees it", async () => {
    vi.useFakeTimers();
    const { useStore, markreadSet, channel } = await boot({ selected: true });
    useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [KEY]: [...state.messages[KEY], message(4)],
      },
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).toHaveBeenCalledWith(
      SERVER,
      "#chan",
      new Date(BASE + 4000).toISOString(),
    );
    expect(channel().unreadCount).toBe(0);
  });

  it("leaves the marker alone while the chat is scrolled up", async () => {
    vi.useFakeTimers();
    const { useStore, markreadSet } = await boot({ selected: true });
    useStore.setState((state) => ({
      ui: { ...state.ui, isChatAwayFromPresent: true },
      messages: {
        ...state.messages,
        [KEY]: [...state.messages[KEY], message(4)],
      },
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).not.toHaveBeenCalled();

    useStore.setState((state) => ({
      ui: { ...state.ui, isChatAwayFromPresent: false },
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).toHaveBeenCalledWith(
      SERVER,
      "#chan",
      new Date(BASE + 4000).toISOString(),
    );
  });

  it("marks the chat read when the user sends to it, even while scrolled up", async () => {
    const { useStore, ircClient, markreadSet, channel } = await boot({
      selected: true,
    });
    useStore.setState((state) => ({
      ui: { ...state.ui, isChatAwayFromPresent: true },
    }));

    ircClient.triggerEvent("rawLine", {
      serverId: SERVER,
      direction: "tx",
      line: "PRIVMSG #chan :on it",
    });

    const newest = new Date(BASE + 3000).toISOString();
    expect(channel().readMarker).toBe(newest);
    expect(channel().unreadCount).toBe(0);
    expect(markreadSet).toHaveBeenCalledWith(SERVER, "#chan", newest);
  });

  it("waits for the stored marker before sending its own", async () => {
    vi.useFakeTimers();
    const { useStore, markreadSet } = await boot({ selected: true });
    useStore.setState((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        channels: server.channels.map((channel) => ({
          ...channel,
          readMarker: undefined,
        })),
      })),
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).not.toHaveBeenCalled();
  });

  it("stops sending markers on a connection once the server refuses one", async () => {
    vi.useFakeTimers();
    const { useStore, ircClient, markreadSet } = await boot({ selected: true });
    ircClient.triggerEvent("MARKREAD_FAIL", {
      serverId: SERVER,
      mtags: undefined,
      code: "INTERNAL_ERROR",
      target: "#chan",
      message: "An account is required for MARKREAD.",
    });
    useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [KEY]: [...state.messages[KEY], message(4)],
      },
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).not.toHaveBeenCalled();
  });

  it("leaves the marker alone while the app is hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const { useStore, markreadSet, channel } = await boot({ selected: true });
    useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [KEY]: [...state.messages[KEY], message(4)],
      },
    }));
    vi.advanceTimersByTime(1000);
    expect(markreadSet).not.toHaveBeenCalled();
    expect(channel().unreadCount).toBe(3);
    visibility.mockRestore();
  });

  it("counts messages from history after the marker as unread, as after a restart", async () => {
    const { useStore, channel } = await boot({ selected: false });
    useStore.setState({ messages: {} });
    expect(channel().unreadCount).toBe(0);

    useStore.setState({
      messages: { [KEY]: [message(1), message(2), message(3, "tester")] },
    });

    expect(channel()).toMatchObject({ unreadCount: 1, isMentioned: false });
  });

  it("marks a chat read when the user leaves it before the marker would go out", async () => {
    vi.useFakeTimers();
    const { useStore, markreadSet, channel } = await boot({ selected: true });
    useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [KEY]: [...state.messages[KEY], message(4)],
      },
    }));
    useStore.setState((state) => ({
      ui: { ...state.ui, selectedServerId: null },
    }));

    expect(markreadSet).toHaveBeenCalledWith(
      SERVER,
      "#chan",
      new Date(BASE + 4000).toISOString(),
    );
    expect(channel().unreadCount).toBe(0);
  });

  it("counts the first private message on a server without read markers", async () => {
    const { useStore, ircClient } = await boot({ selected: false });
    useStore.setState((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        capabilities: [],
        privateChats: [
          {
            id: "pm-bob",
            username: "bob",
            serverId: SERVER,
            unreadCount: 0,
            isMentioned: false,
          },
        ],
      })),
    }));
    ircClient.triggerEvent("parsedLine", {
      serverId: SERVER,
      line: ":irc.test 001 tester :Welcome",
      command: "001",
      source: "irc.test",
      parv: ["tester", "Welcome"],
      mtags: { time: new Date(Date.now() - 1000).toISOString() },
    });
    useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [`${SERVER}-pm-bob`]: [{ ...message(1, "bob"), timestamp: new Date() }],
      },
    }));

    expect(useStore.getState().servers[0].privateChats?.[0]).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
      isMentioned: true,
    });
  });
});
