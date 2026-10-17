import { beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import { playNotificationSound } from "../../src/lib/notificationSounds";
import { showMentionNotification } from "../../src/lib/notifications";
import useStore from "../../src/store";
import {
  registerServerReplyHandlers,
  reportServerReply,
} from "../../src/store/handlers/serverReplies";

vi.mock("../../src/lib/notificationSounds", () => ({
  playNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => true),
}));

vi.mock("../../src/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/notifications")>()),
  showMentionNotification: vi.fn(),
}));

const serverId = "s1";
const reply = {
  serverId,
  type: "fail" as const,
  command: "MARKREAD",
  code: "ACCOUNT_REQUIRED",
  message: "You need an account",
};

function seedServer() {
  useStore.setState({
    servers: [
      {
        id: serverId,
        name: "test",
        host: "irc.example.com",
        port: 443,
        channels: [],
        privateChats: [],
        isConnected: true,
        users: [],
      } as never,
    ],
    messages: {},
    serverAlerts: {},
    unreadServerNotices: {},
    globalNotifications: [],
  });
}

function notices() {
  return useStore.getState().messages[`${serverId}-server-notices`] ?? [];
}

function expectQuiet() {
  const state = useStore.getState();
  expect(playNotificationSound).not.toHaveBeenCalled();
  expect(showMentionNotification).not.toHaveBeenCalled();
  expect(state.globalNotifications).toHaveLength(0);
  expect(state.servers[0].channels.some((c) => c.isMentioned)).toBe(false);
  expect(state.servers[0].privateChats).toHaveLength(0);
  expect(state.unreadServerNotices[serverId]).toBe(true);
}

describe("server notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedServer();
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue({
      username: "me",
    } as never);
  });

  test("counts a failure as a problem without a sound or a toast", () => {
    document.dispatchEvent(new KeyboardEvent("keydown"));
    reportServerReply(useStore, reply);
    reportServerReply(useStore, { ...reply, type: "note", message: "FYI" });
    expect(notices()).toHaveLength(2);
    expect(notices()[0].standardReplyType).toBe("FAIL");
    expect(useStore.getState().serverAlerts[serverId]).toBe(1);
    expectQuiet();
  });

  test("keeps a server's welcome notice naming a command quiet", () => {
    ircClient.triggerEvent("USERNOTICE", {
      serverId,
      mtags: undefined,
      sender: "irc.example.com",
      message: "   /CATFACT - Learn about cats, me",
      timestamp: new Date(),
    });
    expect(notices()[0].content).toContain("/CATFACT");
    expect(useStore.getState().serverAlerts[serverId]).toBeUndefined();
    expectQuiet();
  });

  test("keeps a server command's private reply quiet", () => {
    ircClient.triggerEvent("USERMSG", {
      serverId,
      mtags: undefined,
      sender: "irc.example.com",
      target: "me",
      message: "Cat Fact: me, cats sleep a lot",
      timestamp: new Date(),
    });
    expect(notices()).toHaveLength(1);
    expect(useStore.getState().serverAlerts[serverId]).toBeUndefined();
    expectQuiet();
  });
});

describe("server notices unread marks", () => {
  test("clears once the user looks at the server notices", () => {
    seedServer();
    registerServerReplyHandlers(useStore);
    reportServerReply(useStore, reply);
    expect(useStore.getState().unreadServerNotices[serverId]).toBe(true);
    expect(useStore.getState().serverAlerts[serverId]).toBe(1);
    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        isNarrowView: false,
        selectedServerId: serverId,
        perServerSelections: {
          ...state.ui.perServerSelections,
          [serverId]: {
            selectedChannelId: "server-notices",
            selectedPrivateChatId: null,
          },
        },
      },
    }));
    expect(useStore.getState().unreadServerNotices[serverId]).toBe(false);
    expect(useStore.getState().serverAlerts[serverId]).toBe(0);
  });
});
