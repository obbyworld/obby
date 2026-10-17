import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { AppState } from "../index";

export const SERVER_NOTICES_ID = "server-notices";

export interface ServerReply {
  serverId: string;
  type: "fail" | "warn" | "note";
  command: string;
  code: string;
  message: string;
  target?: string;
  context?: string[];
}

const REPLY_TYPES = { fail: "FAIL", warn: "WARN", note: "NOTE" } as const;

/** Files a server reply under the server's notices and counts problems the
 *  user has not looked at yet. */
export function reportServerReply(
  store: StoreApi<AppState>,
  reply: ServerReply,
): void {
  const { serverId, type, command, code, message, target, context } = reply;
  if (type !== "note")
    store.setState((s) => ({
      serverAlerts: {
        ...s.serverAlerts,
        [serverId]: (s.serverAlerts[serverId] ?? 0) + 1,
      },
    }));
  store.getState().addMessage({
    id: uuidv4(),
    type: "standard-reply",
    content: message,
    timestamp: new Date(),
    userId: "system",
    channelId: SERVER_NOTICES_ID,
    serverId,
    reactions: [],
    replyMessage: null,
    mentioned: [],
    standardReplyType: REPLY_TYPES[type],
    standardReplyCommand: command,
    standardReplyCode: code,
    standardReplyTarget: target,
    standardReplyContext: context,
    standardReplyMessage: message,
  });
}

/** Marks a server's notices read whenever they are on screen, however the
 *  user got there. */
export function registerServerReplyHandlers(store: StoreApi<AppState>): void {
  store.subscribe((state) => {
    const serverId = state.ui.selectedServerId;
    if (
      !serverId ||
      (!state.unreadServerNotices[serverId] && !state.serverAlerts[serverId])
    )
      return;
    const isViewingNotices =
      state.ui.perServerSelections[serverId]?.selectedChannelId ===
        SERVER_NOTICES_ID &&
      (!state.ui.isNarrowView ||
        state.ui.mobileViewActiveColumn === "chatView");
    if (!isViewingNotices) return;
    store.setState({
      serverAlerts: { ...state.serverAlerts, [serverId]: 0 },
      unreadServerNotices: { ...state.unreadServerNotices, [serverId]: false },
    });
  });
}
