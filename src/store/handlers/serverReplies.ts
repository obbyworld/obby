import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { AppState } from "../index";

export const SERVER_NOTICES_ID = "server-notices";

// We only toast a reply that arrives this soon after the user's last tap or
// key, since it most likely answers what they just did.
const USER_ACTION_WINDOW_MS = 5000;

let lastInteractionAt = 0;
if (typeof document !== "undefined") {
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(
      type,
      () => {
        lastInteractionAt = Date.now();
      },
      true,
    );
  }
}

export interface ServerReply {
  serverId: string;
  type: "fail" | "warn" | "note";
  command: string;
  code: string;
  message: string;
  target?: string;
  context?: string[];
  /** We never toast this reply. */
  isQuiet?: boolean;
}

const REPLY_TYPES = { fail: "FAIL", warn: "WARN", note: "NOTE" } as const;

/** Files a server reply under the server's notices, counts problems the user
 *  has not looked at yet, and toasts only the ones they just caused. */
export function reportServerReply(
  store: StoreApi<AppState>,
  reply: ServerReply,
): void {
  const { serverId, type, command, code, message, target, context } = reply;
  const state = store.getState();
  state.addMessage({
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
  if (type === "note") return;

  store.setState((s) => ({
    serverAlerts: {
      ...s.serverAlerts,
      [serverId]: (s.serverAlerts[serverId] ?? 0) + 1,
    },
  }));
  if (
    !reply.isQuiet &&
    Date.now() - lastInteractionAt < USER_ACTION_WINDOW_MS
  ) {
    state.addGlobalNotification({
      type,
      command,
      code,
      message,
      target,
      serverId,
      inServerNotices: true,
    });
  }
}

/** Clears a server's problem count whenever its notices are on screen,
 *  however the user got there. */
export function registerServerReplyHandlers(store: StoreApi<AppState>): void {
  store.subscribe((state) => {
    const serverId = state.ui.selectedServerId;
    if (!serverId || !state.serverAlerts[serverId]) return;
    const isViewingNotices =
      state.ui.perServerSelections[serverId]?.selectedChannelId ===
        SERVER_NOTICES_ID &&
      (!state.ui.isNarrowView ||
        state.ui.mobileViewActiveColumn === "chatView");
    if (!isViewingNotices) return;
    store.setState({
      serverAlerts: { ...state.serverAlerts, [serverId]: 0 },
    });
  });
}
