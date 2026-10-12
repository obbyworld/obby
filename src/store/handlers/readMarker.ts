import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  closeMentionNotification,
  privateMessageNotificationName,
} from "../../lib/notifications";
import type { Channel, PrivateChat } from "../../types";
import {
  getViewedSelection,
  newestMessageTime,
  serverTracksReadMarker,
} from "../helpers";
import type { AppState } from "../index";

// We wait for a burst of messages to settle before telling the server, so a
// busy channel costs one MARKREAD a second at most.
const MARK_READ_DELAY_MS = 1000;

function eqIC(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function clearUnread<T extends Channel | PrivateChat>(chat: T): T {
  return { ...chat, unreadCount: 0, mentionCount: 0, isMentioned: false };
}

function isReadUpTo(marker: string | null, newest: number | undefined) {
  return (
    marker !== null && newest !== undefined && Date.parse(marker) >= newest
  );
}

function viewedChat(state: AppState) {
  const serverId = state.ui.selectedServerId;
  const server = state.servers.find((s) => s.id === serverId);
  if (!server) return undefined;
  const { selectedChannelId, selectedPrivateChatId } =
    getViewedSelection(state);
  const channel = server.channels.find((c) => c.id === selectedChannelId);
  const privateChat = server.privateChats?.find(
    (pc) => pc.id === selectedPrivateChatId,
  );
  const chat = channel ?? privateChat;
  if (!chat) return undefined;
  return {
    server,
    chat,
    target: channel?.name ?? privateChat?.username ?? "",
    key: `${server.id}-${chat.id}`,
  };
}

// We tell the server how far the user has read whenever they look at a chat,
// which clears the unread state on their other clients.
function markViewedChatRead(store: StoreApi<AppState>) {
  const state = store.getState();
  const viewed = viewedChat(state);
  if (!viewed) return;
  const { server, chat, target, key } = viewed;
  if (state.ui.isChatAwayFromPresent) return;
  // Until the server tells us the stored marker, ours could only replace it.
  if (chat.readMarker === undefined && serverTracksReadMarker(state, server.id))
    return;
  if (chat.unreadCount || chat.mentionCount || chat.isMentioned)
    store.setState((s) => ({
      servers: s.servers.map((sv) =>
        sv.id !== server.id
          ? sv
          : {
              ...sv,
              channels: sv.channels.map((c) =>
                c.id === chat.id ? clearUnread(c) : c,
              ),
              privateChats: sv.privateChats?.map((pc) =>
                pc.id === chat.id ? clearUnread(pc) : pc,
              ),
            },
      ),
    }));
  if (!serverTracksReadMarker(state, server.id)) return;
  const newest = newestMessageTime(state, key);
  if (newest === undefined || isReadUpTo(chat.readMarker ?? null, newest))
    return;
  ircClient.markreadSet(server.id, target, new Date(newest).toISOString());
}

export function registerReadMarkerHandlers(store: StoreApi<AppState>): void {
  ircClient.on("MARKREAD", ({ serverId, target, timestamp }) => {
    let isAllRead = false;
    store.setState((state) => {
      let touched = false;
      const updatedServers = state.servers.map((server) => {
        if (server.id !== serverId) return server;
        let serverTouched = false;
        const readUpTo = <T extends Channel | PrivateChat>(chat: T): T => {
          const isRead = isReadUpTo(
            timestamp,
            newestMessageTime(state, `${serverId}-${chat.id}`),
          );
          isAllRead ||= isRead;
          return isRead ? clearUnread(chat) : chat;
        };

        const channels = server.channels.map((channel) => {
          if (!eqIC(channel.name, target)) return channel;
          if (channel.readMarker === timestamp) return channel;
          serverTouched = true;
          return readUpTo({ ...channel, readMarker: timestamp });
        });

        const privateChats = (server.privateChats || []).map((pc) => {
          if (!eqIC(pc.username, target)) return pc;
          const same = pc.readMarker === timestamp;
          if (same && pc.readMarkerFetched) return pc;
          serverTouched = true;
          return readUpTo({
            ...pc,
            readMarker: timestamp,
            readMarkerFetched: true,
          });
        });

        if (!serverTouched) return server;
        touched = true;
        return { ...server, channels, privateChats };
      });

      if (!touched) return {};
      return { servers: updatedServers };
    });
    if (isAllRead) {
      closeMentionNotification(serverId, target);
      closeMentionNotification(
        serverId,
        privateMessageNotificationName(target),
      );
    }
  });

  const setRefused = (serverId: string, readMarkerRefused: boolean) =>
    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId &&
        !!server.readMarkerRefused !== readMarkerRefused
          ? { ...server, readMarkerRefused }
          : server,
      ),
    }));
  // A server can refuse markers, e.g. without an account, so we stop asking on
  // that connection after its first FAIL.
  ircClient.on("MARKREAD_FAIL", ({ serverId }) => setRefused(serverId, true));
  ircClient.on("connectionStateChange", ({ serverId, connectionState }) => {
    if (connectionState === "connected") setRefused(serverId, false);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleMarkRead = () => {
    clearTimeout(timer);
    timer = setTimeout(() => markViewedChatRead(store), MARK_READ_DELAY_MS);
  };

  store.subscribe((state, previous) => {
    const viewed = viewedChat(state);
    if (!viewed) return;
    const wasViewed = viewedChat(previous);
    if (
      wasViewed?.key !== viewed.key ||
      wasViewed?.chat.readMarker !== viewed.chat.readMarker ||
      state.ui.isChatAwayFromPresent !== previous.ui.isChatAwayFromPresent ||
      state.messages[viewed.key] !== previous.messages[viewed.key] ||
      state.historyWindows[viewed.key] !== previous.historyWindows[viewed.key]
    )
      scheduleMarkRead();
  });

  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", scheduleMarkRead);
}
