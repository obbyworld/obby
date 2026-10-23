/** Leaving a call should come back to whatever ordinary channel or private
 *  chat the user had open before the call took over, not to the top of the
 *  channel list. The return target is read from the shared selection
 *  history in src/lib/channelHistory.ts, which is fed by a store-level
 *  subscription (src/store/index.ts) that sees a selection however it
 *  arrives -- including one restored from localStorage at startup, which
 *  never goes through selectChannel/selectPrivateChat. See
 *  resolveCallReturnTarget in src/store/index.ts. */
import { beforeEach, describe, expect, it } from "vitest";
import { clearSelectionHistory } from "../../src/lib/channelHistory";
import type { AppState } from "../../src/store";
import useStore, { resolveCallReturnTarget } from "../../src/store";
import type { Channel, PrivateChat } from "../../src/types";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-general",
    name: "#general",
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [],
    ...overrides,
  };
}

function makePrivateChat(overrides: Partial<PrivateChat> = {}): PrivateChat {
  return {
    id: "pc-bob",
    username: "bob",
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    ...overrides,
  };
}

function setupServer() {
  clearSelectionHistory();
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [
          makeChannel(),
          makeChannel({ id: "chan-voice", name: "^voice" }),
        ],
        privateChats: [makePrivateChat()],
        isConnected: true,
        users: [],
      },
    ],
    messages: {},
    activeBatches: {},
  } as unknown as AppState);
  useStore.setState((state) => ({
    ui: {
      ...state.ui,
      selectedServerId: null,
      perServerSelections: {},
    },
  }));
}

describe("call return memory", () => {
  beforeEach(() => {
    setupServer();
  });

  it("keeps pointing at the ordinary channel after selecting a call channel", () => {
    const { selectChannel } = useStore.getState();

    selectChannel("chan-general");
    selectChannel("chan-voice");

    expect(resolveCallReturnTarget(useStore.getState(), "srv-1")).toEqual({
      type: "channel",
      id: "chan-general",
    });
  });

  it("records a selected private chat as the return target", () => {
    const { selectPrivateChat } = useStore.getState();

    selectPrivateChat("pc-bob");

    expect(resolveCallReturnTarget(useStore.getState(), "srv-1")).toEqual({
      type: "privateChat",
      id: "pc-bob",
    });
  });

  // The bug this whole mechanism exists to fix: at startup the app loads a
  // restored selection straight into state (see loadUISelections() in
  // src/store/index.ts), never calling selectChannel. A memory that only
  // recorded selections made through selectChannel stayed empty here and
  // fell back to the top of the channel list -- "#lobby" below -- instead
  // of the channel the user actually had open, "#general".
  it("treats a selection restored without selectChannel as a valid return target", () => {
    useStore.setState((state) => ({
      servers: [
        {
          ...state.servers[0],
          channels: [
            makeChannel({ id: "chan-lobby", name: "#lobby" }),
            ...state.servers[0].channels,
          ],
        },
      ],
    }));

    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        selectedServerId: "srv-1",
        perServerSelections: {
          "srv-1": {
            selectedChannelId: "chan-general",
            selectedChannelName: "#general",
            selectedPrivateChatId: null,
          },
        },
      },
    }));

    useStore.getState().selectChannel("chan-voice");

    expect(resolveCallReturnTarget(useStore.getState(), "srv-1")).toEqual({
      type: "channel",
      id: "chan-general",
    });
  });

  it("falls back to the first # channel when nothing was remembered", () => {
    const target = resolveCallReturnTarget(useStore.getState(), "srv-1");
    expect(target).toEqual({ type: "channel", id: "chan-general" });
  });
});
