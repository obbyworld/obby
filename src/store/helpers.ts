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

// Older messages past the cap would push themselves straight out again, so we
// drop the newest end instead and keep it as the present of a history window.
export function capMergedMessages(
  existing: Message[],
  merged: Message[],
  window: HistoryWindow | undefined,
): { messages: Message[]; window?: HistoryWindow } {
  const isOlder =
    existing.length > 0 && messageTime(merged[0]) < messageTime(existing[0]);
  if (merged.length <= MAX_MESSAGES_PER_CHANNEL || !isOlder)
    return { messages: merged.slice(-MAX_MESSAGES_PER_CHANNEL) };
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
