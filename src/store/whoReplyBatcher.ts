// Coalesces 352/354 WHO replies so the member list renders once, not
// once per user. Both WHO_REPLY (RFC 1459 RPL_WHOREPLY) and WHOX_REPLY
// (RPL_WHOSPCRPL, /WHO ... %xxx) arrive one per user. On a big channel
// that's hundreds of immediate `store.setState`s, each remapping every
// server/channel/user -- React re-renders the MemberList that many
// times and the user sees the list tick in one nick at a time.
//
// Pattern: each incoming reply pushes a pending update into a per-
// (serverId, channelName) buffer. A short idle timer (FLUSH_IDLE_MS)
// flushes the entire buffer in one setState. An optional hard ceiling
// flushes anyway so very slow servers don't appear stalled.

import type { StoreApi } from "zustand";
import type { User } from "../types";
import type { AppState } from "./index";

// 60 ms: long enough for a single WHO burst to coalesce on common
// networks, short enough that the perceived "loading" is brief.
const FLUSH_IDLE_MS = 60;
// 1000 ms: hard ceiling so a trickling WHO (slow server, link
// degradation) still produces visible progress.
const FLUSH_MAX_MS = 1000;

export interface BufferedWhoEntry {
  nick: string;
  username?: string;
  host?: string;
  realname?: string;
  flags?: string;
  account?: string | null; // null === explicit "0" / no account
  isAway?: boolean;
  isBot?: boolean;
  isIrcOp?: boolean;
  status?: string; // channel prefix flags like "@", "%", etc.
}

interface ChannelBucket {
  serverId: string;
  channel: string;
  byNick: Map<string, BufferedWhoEntry>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  ceilingTimer: ReturnType<typeof setTimeout> | undefined;
}

const buckets = new Map<string, ChannelBucket>();

function key(serverId: string, channel: string): string {
  return `${serverId}|${channel.toLowerCase()}`;
}

function applyBucket(store: StoreApi<AppState>, bucket: ChannelBucket): void {
  if (bucket.idleTimer) {
    clearTimeout(bucket.idleTimer);
    bucket.idleTimer = undefined;
  }
  if (bucket.ceilingTimer) {
    clearTimeout(bucket.ceilingTimer);
    bucket.ceilingTimer = undefined;
  }
  buckets.delete(key(bucket.serverId, bucket.channel));
  if (bucket.byNick.size === 0) return;

  store.setState((state) => {
    const updatedServers = state.servers.map((s) => {
      if (s.id !== bucket.serverId) return s;

      const updatedChannels = s.channels.map((ch) => {
        if (ch.name.toLowerCase() !== bucket.channel.toLowerCase()) return ch;
        const usersByNick = new Map(
          ch.users.map((u) => [u.username.toLowerCase(), u] as const),
        );
        for (const entry of bucket.byNick.values()) {
          const existing = usersByNick.get(entry.nick.toLowerCase());
          if (existing) {
            usersByNick.set(
              entry.nick.toLowerCase(),
              mergeUser(existing, entry),
            );
          } else {
            usersByNick.set(entry.nick.toLowerCase(), entryToUser(entry));
          }
        }
        return { ...ch, users: Array.from(usersByNick.values()) };
      });

      // Mirror to private chats (PM tab metadata such as realname,
      // account, online/away status).
      const updatedPrivateChats = (s.privateChats || []).map((pm) => {
        const entry = bucket.byNick.get(pm.username.toLowerCase());
        if (!entry) return pm;
        return {
          ...pm,
          username: entry.nick, // case correction
          realname: entry.realname ?? pm.realname,
          account: entry.account ?? pm.account,
          isOnline: true,
          isAway: entry.isAway ?? pm.isAway,
          isBot: (pm.isBot || entry.isBot) ?? pm.isBot,
          isIrcOp: entry.isIrcOp ?? pm.isIrcOp,
        };
      });

      return {
        ...s,
        channels: updatedChannels,
        privateChats: updatedPrivateChats,
      };
    });

    return { servers: updatedServers };
  });
}

function mergeUser(prev: User, entry: BufferedWhoEntry): User {
  return {
    ...prev,
    username: entry.nick, // server-authoritative casing
    hostname: entry.host ?? prev.hostname,
    realname: entry.realname ?? prev.realname,
    account: entry.account ?? prev.account,
    isOnline: true,
    isAway: entry.isAway ?? prev.isAway,
    isBot: entry.isBot ?? prev.isBot,
    isIrcOp: entry.isIrcOp ?? prev.isIrcOp,
    status: entry.status ?? prev.status,
  };
}

function entryToUser(entry: BufferedWhoEntry): User {
  return {
    id: entry.nick,
    username: entry.nick,
    hostname: entry.host,
    realname: entry.realname,
    avatar: undefined,
    isOnline: true,
    isAway: !!entry.isAway,
    isBot: !!entry.isBot,
    isIrcOp: !!entry.isIrcOp,
    status: entry.status,
    account: entry.account ?? undefined,
    metadata: {},
  };
}

export function bufferWhoReply(
  store: StoreApi<AppState>,
  serverId: string,
  channel: string,
  entry: BufferedWhoEntry,
): void {
  const k = key(serverId, channel);
  const existing = buckets.get(k);
  const bucket: ChannelBucket = existing ?? {
    serverId,
    channel,
    byNick: new Map(),
    idleTimer: undefined,
    ceilingTimer: undefined,
  };
  if (!existing) {
    buckets.set(k, bucket);
    bucket.ceilingTimer = setTimeout(
      () => applyBucket(store, bucket),
      FLUSH_MAX_MS,
    );
  }
  // Last-write-wins per nick within a burst (the most recent WHO line
  // for a given user is the authoritative one).
  bucket.byNick.set(entry.nick.toLowerCase(), entry);
  if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
  bucket.idleTimer = setTimeout(
    () => applyBucket(store, bucket),
    FLUSH_IDLE_MS,
  );
}

export function flushWhoReplies(
  store: StoreApi<AppState>,
  serverId: string,
  channel: string,
): void {
  const bucket = buckets.get(key(serverId, channel));
  if (bucket) applyBucket(store, bucket);
}

// Test-only helpers.
export function _resetWhoReplyBatcher(): void {
  for (const b of buckets.values()) {
    if (b.idleTimer) clearTimeout(b.idleTimer);
    if (b.ceilingTimer) clearTimeout(b.ceilingTimer);
  }
  buckets.clear();
}

export function _peekWhoReplyBatcher(serverId: string, channel: string) {
  return buckets.get(key(serverId, channel));
}
