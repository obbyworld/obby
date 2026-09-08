import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import type { Channel } from "../../src/types";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-text",
    name: "#lobby",
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [],
    ...overrides,
  };
}

function setup(isNarrowView: boolean) {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [
          makeChannel(),
          makeChannel({ id: "chan-call", name: "^standup" }),
        ],
        privateChats: [],
        isConnected: true,
        users: [],
      },
    ],
    messages: {},
    activeBatches: {},
    globalSettings: { showEvents: true, showJoinsParts: true },
  } as unknown as AppState);

  useStore.setState((state) => ({
    ui: {
      ...state.ui,
      isNarrowView,
      selectedServerId: "srv-1",
      mobileViewActiveColumn: "chatView",
      perServerSelections: {
        "srv-1": {
          selectedChannelId: "chan-call",
          selectedChannelName: "^standup",
          selectedPrivateChatId: null,
          selectedPrivateChatUsername: null,
        },
      },
    },
  }));
}

const selection = () =>
  useStore.getState().ui.perServerSelections["srv-1"]?.selectedChannelId;

describe("leaving a call decides where you land by layout", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "leaveChannel").mockImplementation(() => {});
  });

  it("goes back to the channel list on a narrow layout", () => {
    setup(true);
    useStore.getState().leaveChannel("srv-1", "^standup");

    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
    expect(selection()).toBeNull();
  });

  it("opens a channel on a wide layout, where the list is already visible", () => {
    setup(false);
    useStore.getState().leaveChannel("srv-1", "^standup");

    expect(selection()).toBe("chan-text");
  });

  it("leaves an ordinary channel alone on a narrow layout", () => {
    setup(true);
    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        perServerSelections: {
          "srv-1": {
            selectedChannelId: "chan-text",
            selectedChannelName: "#lobby",
            selectedPrivateChatId: null,
            selectedPrivateChatUsername: null,
          },
        },
      },
    }));

    useStore.getState().leaveChannel("srv-1", "#lobby");

    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
  });
});
