import { beforeEach, describe, expect, it } from "vitest";
import {
  getRecentPlaces,
  getRecentSearches,
} from "../../src/lib/search/recents";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const SID = "srv-1";
const server = {
  id: SID,
  name: "libera",
  host: "irc.libera.chat",
  port: 6697,
  isConnected: true,
  users: [],
  channels: [
    {
      id: "c1",
      name: "#Dev",
      isPrivate: false,
      serverId: SID,
      unreadCount: 0,
      isMentioned: false,
      messages: [],
      users: [],
    },
  ],
  privateChats: [],
} as unknown as Server;

const query = { text: "deploy", scope: { kind: "everywhere" } } as const;

function reset(isNarrowView = false, keepHistory = true) {
  useStore.setState((state) => ({
    servers: [server],
    globalSettings: { ...state.globalSettings, keepHistory },
    ui: {
      ...state.ui,
      isNarrowView,
      sidePane: null,
      quickActions: null,
      selectedServerId: null,
      mobileViewActiveColumn: "chatView",
    },
  }));
}

describe("search ui state", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    window.localStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    } as unknown as Storage;
    reset();
  });

  it("opens Go to when closed and flips the mode when open", () => {
    const { toggleQuickActions } = useStore.getState();
    toggleQuickActions();
    expect(useStore.getState().ui.quickActions).toEqual({ mode: "goto" });
    toggleQuickActions();
    expect(useStore.getState().ui.quickActions).toEqual({ mode: "messages" });
    toggleQuickActions(false);
    expect(useStore.getState().ui.quickActions).toBeNull();
  });

  it("keeps one side pane: results replace the profile and back", () => {
    const state = useStore.getState();
    state.openProfile(SID, "alice");
    state.openSearchResults(query);
    expect(useStore.getState().ui.sidePane).toEqual({ kind: "search", query });
    useStore.getState().closeProfile();
    expect(useStore.getState().ui.sidePane?.kind).toBe("search");
    useStore.getState().openProfile(SID, "alice");
    expect(useStore.getState().ui.sidePane).toEqual({
      kind: "profile",
      serverId: SID,
      username: "alice",
    });
  });

  it("records searches and places only while history is kept", () => {
    useStore.getState().openSearchResults(query);
    expect(getRecentSearches()).toEqual([query]);

    reset(false, false);
    useStore.getState().openSearchResults({ ...query, text: "secret" });
    useStore.getState().openChat(SID, "#dev");
    expect(getRecentSearches()).toEqual([query]);
    expect(getRecentPlaces()).toEqual([]);
  });

  it("returns to the chat when results close on a phone", () => {
    reset(true);
    useStore.getState().openSearchResults(query);
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    useStore.getState().closeSearchResults();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("chatView");
  });

  describe("openChat", () => {
    it("selects a joined channel by any casing", () => {
      expect(useStore.getState().openChat(SID, "#dev")).toBe("c1");
      expect(useStore.getState().ui.selectedServerId).toBe(SID);
      expect(
        useStore.getState().ui.perServerSelections[SID].selectedChannelId,
      ).toBe("c1");
    });

    it("opens and selects a private chat", () => {
      const id = useStore.getState().openChat(SID, "bob");
      const pm = useStore
        .getState()
        .servers[0].privateChats.find((p) => p.username === "bob");
      expect(id).toBe(pm?.id);
      expect(
        useStore.getState().ui.perServerSelections[SID].selectedPrivateChatId,
      ).toBe(id);
    });

    it("refuses a channel we are not in and an unknown server", () => {
      expect(useStore.getState().openChat(SID, "#elsewhere")).toBeNull();
      expect(useStore.getState().openChat("nope", "bob")).toBeNull();
    });
  });
});
