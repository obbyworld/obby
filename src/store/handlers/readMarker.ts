import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  closeMentionNotification,
  privateMessageNotificationName,
} from "../../lib/notifications";
import type { Channel, PrivateChat, Server } from "../../types";
import {
  countUnread,
  getViewedSelection,
  newestMessageTime,
  serverTracksReadMarker,
  type UnreadCounts,
} from "../helpers";
import type { AppState } from "../index";
import { findConversation } from "./history";

// We wait for a burst of messages to settle before telling the server, so a
// busy channel costs one MARKREAD a second at most.
const MARK_READ_DELAY_MS = 1000;

// Channels whose marker we started at the JOIN because the server had none,
// so the first time the user reads one we still tell the server.
const joinedWithoutMarker = new Set<string>();
// We learn which capabilities a server has only once it welcomes us, so we
// start local markers from then on.
const registeredAt = new Map<string, string>();

const NOTHING_UNREAD: UnreadCounts = {
  unreadCount: 0,
  mentionCount: 0,
  isMentioned: false,
};

type Chat = Channel | PrivateChat;

const eqIC = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const chatKey = (serverId: string, chat: Chat) => `${serverId}-${chat.id}`;
const targetOf = (chat: Chat) => ("name" in chat ? chat.name : chat.username);

// An undefined marker is one we have not heard yet, and `*` (null) on a
// private chat means the user has read none of it.
function readUpTo(chat: Chat): number | undefined {
  if (chat.readMarker === undefined) return undefined;
  return chat.readMarker === null
    ? Number.NEGATIVE_INFINITY
    : Date.parse(chat.readMarker);
}

function mapChats(
  servers: Server[],
  serverId: string,
  update: <T extends Chat>(chat: T, isPrivate: boolean) => T,
): Server[] {
  const updated = servers.map((server) => {
    if (server.id !== serverId) return server;
    const channels = server.channels.map((c) => update(c, false));
    const privateChats = server.privateChats?.map((pc) => update(pc, true));
    const isSame =
      channels.every((c, i) => c === server.channels[i]) &&
      (privateChats ?? []).every((pc, i) => pc === server.privateChats?.[i]);
    return isSame ? server : { ...server, channels, privateChats };
  });
  return updated.every((server, i) => server === servers[i])
    ? servers
    : updated;
}

function setReadMarker(
  store: StoreApi<AppState>,
  serverId: string,
  chatId: string,
  readMarker: string,
) {
  store.setState((state) => ({
    servers: mapChats(state.servers, serverId, (chat) =>
      chat.id === chatId && chat.readMarker !== readMarker
        ? { ...chat, readMarker }
        : chat,
    ),
  }));
}

function findChat(state: AppState, serverId: string, chatId: string) {
  const server = state.servers.find((s) => s.id === serverId);
  return (
    server?.channels.find((c) => c.id === chatId) ??
    server?.privateChats?.find((pc) => pc.id === chatId)
  );
}

// On a server without read markers we keep the marker for this session only.
export function markChatRead(
  store: StoreApi<AppState>,
  serverId: string,
  chatId: string,
): void {
  const state = store.getState();
  const chat = findChat(state, serverId, chatId);
  if (!chat) return;
  const tracks = serverTracksReadMarker(state, serverId);
  // Until the server tells us the stored marker, ours could only replace it.
  if (tracks && chat.readMarker === undefined) return;
  const newest = newestMessageTime(state, chatKey(serverId, chat));
  if (newest === undefined) return;
  const key = chatKey(serverId, chat);
  const isServerBehind = tracks && joinedWithoutMarker.has(key);
  if (!isServerBehind && (readUpTo(chat) ?? Number.NEGATIVE_INFINITY) >= newest)
    return;
  joinedWithoutMarker.delete(key);
  const marker = new Date(newest).toISOString();
  setReadMarker(store, serverId, chatId, marker);
  if (tracks) ircClient.markreadSet(serverId, targetOf(chat), marker);
}

function viewedChat(state: AppState) {
  const serverId = state.ui.selectedServerId;
  if (!serverId) return undefined;
  const { selectedChannelId, selectedPrivateChatId } =
    getViewedSelection(state);
  const chatId = selectedChannelId ?? selectedPrivateChatId;
  const chat = chatId ? findChat(state, serverId, chatId) : undefined;
  return chat ? { serverId, chat, key: chatKey(serverId, chat) } : undefined;
}

function sameCounts(chat: Chat, counts: UnreadCounts) {
  return (
    chat.unreadCount === counts.unreadCount &&
    (chat.mentionCount ?? 0) === counts.mentionCount &&
    !!chat.isMentioned === counts.isMentioned
  );
}

const chatInView = (state: AppState) =>
  state.ui.isChatAwayFromPresent ? undefined : viewedChat(state)?.key;

// Unread counts follow from the marker and the messages we hold, so we work
// them out again whenever either changes. The chat the user watches at the
// bottom stays read while its marker waits to go out.
function withUnreadCounts(
  state: AppState,
  previous: AppState,
): Server[] | undefined {
  const inView = chatInView(state);
  const wasInView = chatInView(previous);
  let servers = state.servers;
  for (const server of state.servers) {
    const before = previous.servers.find((s) => s.id === server.id);
    servers = mapChats(servers, server.id, (chat, isPrivate) => {
      const key = chatKey(server.id, chat);
      const old = isPrivate
        ? before?.privateChats?.find((pc) => pc.id === chat.id)
        : before?.channels.find((c) => c.id === chat.id);
      if (
        old?.readMarker === chat.readMarker &&
        state.messages[key] === previous.messages[key] &&
        state.historyWindows[key] === previous.historyWindows[key] &&
        (key === inView) === (key === wasInView)
      )
        return chat;
      const after = key === inView ? undefined : readUpTo(chat);
      const messages = [
        ...(state.messages[key] ?? []),
        ...(state.historyWindows[key]?.present ?? []),
      ];
      const counts =
        after === undefined || messages.length === 0
          ? NOTHING_UNREAD
          : countUnread(
              messages,
              after,
              ircClient.getNick(server.id),
              isPrivate,
            );
      return sameCounts(chat, counts) ? chat : { ...chat, ...counts };
    });
  }
  return servers === state.servers ? undefined : servers;
}

// A server without read markers gives us none to start from, so we count what
// arrived since it welcomed us. A private chat's marker comes only when asked,
// so we ask once per chat.
function startMissingMarkers(store: StoreApi<AppState>) {
  for (const server of store.getState().servers) {
    const since = registeredAt.get(server.id);
    if (!since) continue;
    for (const { id } of [...server.channels, ...(server.privateChats ?? [])]) {
      const state = store.getState();
      const chat = findChat(state, server.id, id);
      if (!chat) continue;
      const tracks = serverTracksReadMarker(state, server.id);
      if (!tracks && chat.readMarker == null)
        setReadMarker(store, server.id, chat.id, since);
      else if (
        tracks &&
        "username" in chat &&
        chat.readMarker === undefined &&
        !chat.readMarkerFetched
      ) {
        store.setState((s) => ({
          servers: mapChats(s.servers, server.id, (pc) =>
            pc.id === chat.id ? { ...pc, readMarkerFetched: true } : pc,
          ),
        }));
        ircClient.markreadGet(server.id, chat.username);
      }
    }
  }
}

export function registerReadMarkerHandlers(store: StoreApi<AppState>): void {
  ircClient.on("MARKREAD", ({ serverId, target, timestamp }) => {
    store.setState((state) => ({
      servers: mapChats(state.servers, serverId, (chat, isPrivate) => {
        if (!eqIC(targetOf(chat), target)) return chat;
        if (!isPrivate) {
          // A channel the user never read has no marker on the server, so we
          // count what arrives from now on and leave its backlog read.
          const key = chatKey(serverId, chat);
          if (timestamp === null) joinedWithoutMarker.add(key);
          else joinedWithoutMarker.delete(key);
          const readMarker =
            timestamp ?? chat.readMarker ?? new Date().toISOString();
          return chat.readMarker === readMarker
            ? chat
            : { ...chat, readMarker };
        }
        return chat.readMarker === timestamp &&
          "username" in chat &&
          chat.readMarkerFetched
          ? chat
          : { ...chat, readMarker: timestamp, readMarkerFetched: true };
      }),
    }));
    const server = store.getState().servers.find((s) => s.id === serverId);
    const chat = [
      ...(server?.channels ?? []),
      ...(server?.privateChats ?? []),
    ].find((c) => eqIC(targetOf(c), target));
    if (chat && chat.unreadCount === 0) {
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
    else registeredAt.delete(serverId);
  });
  // We take the time from the server's welcome when it sends one, so a local
  // clock ahead of the server cannot hide the first messages.
  ircClient.on("parsedLine", ({ serverId, command, mtags }) => {
    if (command !== "001") return;
    registeredAt.set(serverId, mtags?.time ?? new Date().toISOString());
    startMissingMarkers(store);
  });
  // Markers need an account, so a login after the welcome is when we first
  // learn where the user left off.
  ircClient.on("LOGGED_IN", ({ serverId }) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server || !registeredAt.has(serverId)) return;
    if (!serverTracksReadMarker(state, serverId)) return;
    for (const chat of [...server.channels, ...(server.privateChats ?? [])])
      ircClient.markreadGet(serverId, targetOf(chat));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  // We tell the server how far the user has read whenever they look at a
  // chat, which clears the unread state on their other clients.
  const markViewedChatRead = () => {
    const state = store.getState();
    const viewed = viewedChat(state);
    if (viewed && !state.ui.isChatAwayFromPresent)
      markChatRead(store, viewed.serverId, viewed.chat.id);
  };
  const scheduleMarkRead = () => {
    clearTimeout(timer);
    timer = setTimeout(markViewedChatRead, MARK_READ_DELAY_MS);
  };

  store.subscribe((state, previous) => {
    const servers = withUnreadCounts(state, previous);
    if (servers) store.setState({ servers });
    startMissingMarkers(store);
    const viewed = viewedChat(state);
    const wasViewed = viewedChat(previous);
    // The user saw the chat they are leaving up to where they were, so we
    // mark it now; a pending timer would mark the next chat instead.
    if (
      wasViewed &&
      wasViewed.key !== viewed?.key &&
      !previous.ui.isChatAwayFromPresent
    )
      markChatRead(store, wasViewed.serverId, wasViewed.chat.id);
    if (!viewed) return;
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

  // Sending a message means the user has read the chat, so we mark it read
  // at once, even when they switch away or scroll up right after.
  ircClient.on("rawLine", ({ serverId, direction, line }) => {
    if (direction !== "tx") return;
    const target = /^(?:@\S+ )?PRIVMSG (\S+) :/.exec(line)?.[1];
    const chat = target && findConversation(store, serverId, target);
    if (chat) markChatRead(store, serverId, chat.channelId);
  });
}
