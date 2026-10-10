import { beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import {
  registerServerReplyHandlers,
  reportServerReply,
} from "../../src/store/handlers/serverReplies";

const serverId = "s1";
const reply = {
  serverId,
  type: "fail" as const,
  command: "MARKREAD",
  code: "ACCOUNT_REQUIRED",
  message: "You need an account",
};

describe("server replies", () => {
  beforeEach(() => {
    vi.useRealTimers();
    useStore.setState({
      messages: {},
      serverAlerts: {},
      globalNotifications: [],
    });
  });

  test("files a reply under the server notices and counts it unseen", () => {
    reportServerReply(useStore, reply);
    const notices = useStore.getState().messages[`${serverId}-server-notices`];
    expect(notices).toHaveLength(1);
    expect(notices?.[0].standardReplyType).toBe("FAIL");
    expect(useStore.getState().serverAlerts[serverId]).toBe(1);
  });

  test("keeps replies the user did not cause out of the toasts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    reportServerReply(useStore, reply);
    expect(useStore.getState().globalNotifications).toHaveLength(0);
  });

  test("toasts a failure that answers what the user just did", () => {
    document.dispatchEvent(new KeyboardEvent("keydown"));
    reportServerReply(useStore, reply);
    expect(useStore.getState().globalNotifications).toHaveLength(1);
  });

  test("leaves invite link failures to the page that shows them inline", () => {
    document.dispatchEvent(new KeyboardEvent("keydown"));
    const fail = (command: string) =>
      ircClient.triggerEvent("FAIL", {
        serverId,
        command,
        code: "ACCOUNT_REQUIRED",
        context: [],
        message: "You must be logged in",
        mtags: {},
      });
    fail("INVITELINK");
    expect(useStore.getState().globalNotifications).toHaveLength(0);
    fail("MARKREAD");
    expect(useStore.getState().globalNotifications).toHaveLength(1);
  });

  test("never toasts a quiet reply or a note", () => {
    document.dispatchEvent(new KeyboardEvent("keydown"));
    reportServerReply(useStore, { ...reply, isQuiet: true });
    reportServerReply(useStore, { ...reply, type: "note" });
    expect(useStore.getState().globalNotifications).toHaveLength(0);
    expect(useStore.getState().serverAlerts[serverId]).toBe(1);
  });
});

describe("server reply badge", () => {
  test("clears once the user looks at the server notices", () => {
    registerServerReplyHandlers(useStore);
    useStore.setState({ serverAlerts: { [serverId]: 2 } });
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
    expect(useStore.getState().serverAlerts[serverId]).toBe(0);
  });
});
