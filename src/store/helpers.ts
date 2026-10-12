import { v5 as uuidv5 } from "uuid";
import type { Channel, Message, Server, User } from "../types";
import type { AppState } from "./index";
import type { HistoryWindow } from "./types";

export function findServerUser(
  server: Server | undefined,
  nick: string,
): User | undefined {
  const lower = nick.toLowerCase();
  for (const channel of server?.channels ?? []) {
    const user = channel.users.find((u) => u.username.toLowerCase() === lower);
    if (user) return user;
  }
  return undefined;
}

// Namespace UUID for generating deterministic channel/chat IDs
export const CHANNEL_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Generate a deterministic UUID for a channel or private chat
 * based on the server ID and channel/chat name
 */
export function generateDeterministicId(
  serverId: string,
  name: string,
): string {
  return uuidv5(`${serverId}:${name}`, CHANNEL_NAMESPACE);
}

/**
 * Normalize host for comparison (extract hostname from URL or return as-is)
 */
export function normalizeHost(host: string): string {
  if (host.includes("://")) {
    // Extract hostname from URL format
    const withoutProtocol = host.replace(/^(irc|ircs|wss):\/\//, "");
    return withoutProtocol.split(":")[0]; // Get just hostname, strip port if present
  }
  return host;
}

/**
 * Ensure host is in URL format
 */
export function ensureUrlFormat(host: string, port: number): string {
  if (host.includes("://")) {
    return host; // Already in URL format
  }
  // Convert old hostname-only format to URL — always wss://
  return `wss://${host}:${port}`;
}

export const MAX_MESSAGES_PER_CHANNEL = 1500;

export const messageTime = (message: Message) =>
  new Date(message.timestamp).getTime();

const isChatMessage = (message: Message) =>
  message.type === "message" || message.type === undefined;

// The newest message we hold for a chat, counting live messages a history
// window is keeping aside.
export function newestMessageTime(
  state: AppState,
  key: string,
): number | undefined {
  const messages = state.historyWindows[key]?.present ?? state.messages[key];
  let newest: number | undefined;
  for (const message of messages ?? []) {
    const time = messageTime(message);
    if (isChatMessage(message) && !Number.isNaN(time))
      newest = newest === undefined ? time : Math.max(newest, time);
  }
  return newest;
}

// The message a "New messages" line goes above: the first message from someone
// else that is newer than the read marker.
export function firstUnreadMessageId(
  messages: Message[],
  readUpTo: number,
  ownNick: string | undefined,
): string | undefined {
  const own = ownNick?.toLowerCase();
  return messages.find((message) => isUnread(message, readUpTo, own))?.id;
}

const isUnread = (message: Message, readUpTo: number, own?: string) =>
  isChatMessage(message) &&
  messageTime(message) > readUpTo &&
  message.userId.toLowerCase() !== own;

export type UnreadCounts = {
  unreadCount: number;
  mentionCount: number;
  isMentioned: boolean;
};

// Unread messages are the ones from someone else newer than the read marker.
// Every private message is addressed to the user, so each one is a mention.
export function countUnread(
  messages: Message[],
  readUpTo: number,
  ownNick: string | undefined,
  isPrivate: boolean,
): UnreadCounts {
  const own = ownNick?.toLowerCase();
  const counted = new Set<string>();
  let unreadCount = 0;
  let mentionCount = 0;
  for (const message of messages) {
    const id = message.msgid ?? message.id;
    if (counted.has(id) || !isUnread(message, readUpTo, own)) continue;
    counted.add(id);
    unreadCount += 1;
    if (
      isPrivate ||
      message.mentioned.length > 0 ||
      (own !== undefined && message.replyMessage?.userId.toLowerCase() === own)
    )
      mentionCount += 1;
  }
  return { unreadCount, mentionCount, isMentioned: mentionCount > 0 };
}

export function serverTracksReadMarker(
  state: AppState,
  serverId: string,
): boolean {
  const server = state.servers.find((s) => s.id === serverId);
  return (
    !!server?.capabilities?.includes("draft/read-marker") &&
    !server.readMarkerRefused
  );
}

const replaceAt = <T>(list: T[], index: number, item: T): T[] =>
  list.map((existing, i) => (i === index ? item : existing));

// A detached chat keeps its newest messages in the window's present, so we
// look there too. `update` returns null to leave the message as it is.
// A redacted message keeps who removed it as a code, and the row translates it.
export const REDACTED_BY_TAG = "obby-redacted-by";

export function withReaction(
  message: Message,
  emoji: string,
  userId: string,
): Message | null {
  return message.reactions.some((r) => r.emoji === emoji && r.userId === userId)
    ? null
    : { ...message, reactions: [...message.reactions, { emoji, userId }] };
}

export function withoutReaction(
  message: Message,
  emoji: string,
  userId: string,
): Message | null {
  const reactions = message.reactions.filter(
    (r) => !(r.emoji === emoji && r.userId === userId),
  );
  return reactions.length === message.reactions.length
    ? null
    : { ...message, reactions };
}

// A multiline message answers to its own msgid and to each of its lines' msgids.
export function hasMsgid(message: Message, msgid: string): boolean {
  return (
    message.msgid === msgid || !!message.multilineMessageIds?.includes(msgid)
  );
}

// Replayed history (server CHATHISTORY or our local replay) updates what was
// said, never live state such as typing, presence, notifications or bot runs.
export function isHistoryEvent(
  state: Pick<AppState, "activeBatches">,
  serverId: string,
  mtags: Record<string, string> | undefined,
): boolean {
  const batchId = mtags?.batch;
  return (
    !!batchId &&
    state.activeBatches[serverId]?.[batchId]?.type === "chathistory"
  );
}

export function redactedMessage(original: Message, sender: string): Message {
  return {
    id: original.id,
    msgid: original.msgid,
    content: "",
    timestamp: original.timestamp,
    userId: "system",
    channelId: original.channelId,
    serverId: original.serverId,
    type: "system",
    reactions: [],
    replyMessage: null,
    mentioned: [],
    tags: {
      ...original.tags,
      [REDACTED_BY_TAG]: original.userId === sender ? "sender" : "staff",
    },
  };
}

export function updateMessageByMsgid(
  state: Pick<AppState, "messages" | "historyWindows">,
  key: string,
  msgid: string,
  update: (message: Message) => Message | null,
): Partial<AppState> {
  const shown = state.messages[key] ?? [];
  const index = shown.findIndex((m) => hasMsgid(m, msgid));
  if (index >= 0) {
    const next = update(shown[index]);
    return next
      ? {
          messages: { ...state.messages, [key]: replaceAt(shown, index, next) },
        }
      : {};
  }
  const window = state.historyWindows[key];
  const presentIndex =
    window?.present.findIndex((m) => hasMsgid(m, msgid)) ?? -1;
  if (!window || presentIndex < 0) return {};
  const next = update(window.present[presentIndex]);
  if (!next) return {};
  return {
    historyWindows: {
      ...state.historyWindows,
      [key]: {
        ...window,
        present: replaceAt(window.present, presentIndex, next),
      },
    },
  };
}

// Older messages past the cap would push themselves straight out again, so we
// drop the newest end instead and keep it as the present of a history window.
export function capMergedMessages(
  existing: Message[],
  merged: Message[],
  window: HistoryWindow | undefined,
): { messages: Message[]; window?: HistoryWindow } {
  const isOlder =
    existing.length > 0 && messageTime(merged[0]) < messageTime(existing[0]);
  if (merged.length <= MAX_MESSAGES_PER_CHANNEL || (!isOlder && window))
    return { messages: merged };
  if (!isOlder) return { messages: merged.slice(-MAX_MESSAGES_PER_CHANNEL) };
  const kept = merged.slice(0, MAX_MESSAGES_PER_CHANNEL);
  return {
    messages: kept,
    window: {
      ...window,
      until: messageTime(kept[kept.length - 1]),
      untilRowId: undefined,
      present: window?.present ?? existing,
    },
  };
}

// ============================================================================
// Batch Event Types
// ============================================================================

export interface JoinBatchEvent {
  type: "JOIN";
  data: {
    serverId: string;
    username: string;
    channelName: string;
    account?: string; // From extended-join
    realname?: string; // From extended-join
  };
}

export interface QuitBatchEvent {
  type: "QUIT";
  data: {
    serverId: string;
    username: string;
    reason: string;
  };
}

export interface PartBatchEvent {
  type: "PART";
  data: {
    serverId: string;
    username: string;
    channelName: string;
    reason?: string;
  };
}

export type BatchEvent = JoinBatchEvent | QuitBatchEvent | PartBatchEvent;

export interface BatchInfo {
  type: string;
  parameters?: string[];
  events: BatchEvent[];
  startTime: Date;
}

// ============================================================================
// Per-Server Selection Helpers
// ============================================================================

/**
 * Get the selected channel and private chat for a specific server
 */
export function getServerSelection(state: AppState, serverId: string) {
  return (
    state.ui.perServerSelections[serverId] || {
      selectedChannelId: null,
      selectedPrivateChatId: null,
    }
  );
}

/**
 * Set the selected channel and private chat for a specific server
 */
export function setServerSelection(
  state: AppState,
  serverId: string,
  selection: {
    selectedChannelId: string | null;
    selectedChannelName?: string | null;
    selectedPrivateChatId: string | null;
    selectedPrivateChatUsername?: string | null;
  },
) {
  return {
    ...state.ui.perServerSelections,
    [serverId]: selection,
  };
}

/**
 * Get the current selection for the currently selected server
 */
export function getCurrentSelection(state: AppState) {
  if (!state.ui.selectedServerId) {
    return {
      selectedChannelId: null,
      selectedPrivateChatId: null,
    };
  }
  return getServerSelection(state, state.ui.selectedServerId);
}

// A phone shows one app at a time, so a visible app there has the user's eyes,
// while a desktop window also needs focus.
export function isAppInFront(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined")
    return true;
  if (document.visibilityState !== "visible") return false;
  return (
    document.hasFocus() ||
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

// The chat the user is looking at right now: selected, with the app in front
// and, on a phone, the chat column showing. Messages anywhere else are unread.
export function getViewedSelection(state: AppState) {
  const isInView =
    state.ui.isAppFocused !== false &&
    (!state.ui.isNarrowView || state.ui.mobileViewActiveColumn === "chatView");
  return isInView
    ? getCurrentSelection(state)
    : { selectedChannelId: null, selectedPrivateChatId: null };
}

// ============================================================================
// Server Capability Helpers (pure versions)
// ============================================================================

/**
 * Check if a server supports metadata capability
 */
export function serverSupportsMetadata(
  state: AppState,
  serverId: string,
): boolean {
  const server = state.servers.find((s) => s.id === serverId);
  const supports =
    server?.capabilities?.some(
      (cap) => cap === "draft/metadata-2" || cap.startsWith("draft/metadata"),
    ) ?? false;
  return supports;
}

export function serverSupportsChathistory(
  state: AppState,
  serverId: string,
): boolean {
  return !!state.servers
    .find((s) => s.id === serverId)
    ?.capabilities?.includes("draft/chathistory");
}

/**
 * Check if a server supports multiline capability
 */
export function serverSupportsMultiline(
  state: AppState,
  serverId: string,
): boolean {
  const server = state.servers.find((s) => s.id === serverId);
  const supports = server?.capabilities?.includes("draft/multiline") ?? false;
  return supports;
}

// ============================================================================
// User Metadata Resolution
// ============================================================================

type UserMetadata = NonNullable<User["metadata"]>;

/**
 * Resolve cached metadata for a user: localStorage wins, cross-channel is fallback.
 * Both the NAMES and live-JOIN paths use this so avatar data is available immediately.
 */
export function resolveUserMetadata(
  username: string,
  serverMetadata: Record<string, UserMetadata> | undefined,
  channels: Channel[],
  excludeChannelName?: string,
): UserMetadata {
  const lc = username.toLowerCase();
  if (serverMetadata) {
    const matchingKey = Object.keys(serverMetadata).find(
      (k) => k.toLowerCase() === lc,
    );
    if (matchingKey && Object.keys(serverMetadata[matchingKey]).length > 0) {
      return { ...serverMetadata[matchingKey] };
    }
  }
  const exclude = excludeChannelName?.toLowerCase();
  for (const ch of channels) {
    if (exclude && ch.name.toLowerCase() === exclude) continue;
    const existing = ch.users.find((u) => u.username.toLowerCase() === lc);
    if (existing?.metadata && Object.keys(existing.metadata).length > 0) {
      return { ...existing.metadata };
    }
  }
  return {};
}

// ============================================================================
// Reply Message Resolution (pure version)
// ============================================================================

/**
 * Resolve a reply message from message tags
 * @param mtags Message tags from IRC message
 * @param serverId Server ID for context
 * @param channelId Channel ID for context
 * @param messages Array of messages to search through
 * @returns The referenced message or null if not found
 */
export function resolveReplyMessage(
  mtags: Record<string, string> | undefined,
  serverId: string,
  channelId: string,
  messages: Message[],
): Message | null {
  return findReplyTarget(
    (mtags?.["+reply"] ?? mtags?.["+draft/reply"])?.trim() || null,
    messages,
  );
}

/**
 * Find the message a reply points at, for callers that already hold the id
 * rather than the tags it arrived in.
 */
export function findReplyTarget(
  replyId: string | null | undefined,
  messages: Message[],
): Message | null {
  if (!replyId) {
    return null;
  }

  return (
    messages.find(
      (message) =>
        message.msgid === replyId ||
        message.multilineMessageIds?.includes(replyId),
    ) ?? null
  );
}
