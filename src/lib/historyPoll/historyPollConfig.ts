// We poll history from the mobile apps only as the fallback for servers without
// web push; deleting this folder and the native history poll removes it.
import { invoke } from "@tauri-apps/api/core";
import type { GlobalSettings } from "../../store/types";
import type { Server, ServerConfig } from "../../types";
import {
  areChatNotificationsOn,
  encryptedNotificationText,
  notificationTitle,
} from "../notifications";
import { isTauriMobile } from "../platformUtils";

/** Android runs periodic work at most this often; iOS decides on its own. */
const HISTORY_POLL_INTERVAL_MINUTES = 15;

export interface HistoryPollServer {
  id: string;
  address: string;
  nick: string;
  account?: string;
  password?: string;
  serverPassword?: string;
  bouncerNetid?: string;
  customMentions: string[];
  ignoreList: string[];
  since: number;
}

export interface HistoryPollConfig {
  servers: HistoryPollServer[];
  strings: { channelTitle: string; encryptedBody: string };
}

export interface LiveServerState {
  nickOf: (serverId: string) => string | undefined;
  hasCapability: (serverId: string, capability: string) => boolean;
}

// Until a server has logged in and told us whether it keeps history, we keep
// the last config, so a launch without network never cancels the poll.
export function isHistoryPollDecided(
  servers: Server[],
  live: LiveServerState,
): boolean {
  return servers.every(
    (server) =>
      server.isConnected &&
      (server.isBouncerControl ||
        !!server.bouncerNetid ||
        server.persistenceEffective !== undefined ||
        !live.hasCapability(server.id, "draft/persistence")),
  );
}

// We only poll servers that keep history for us, so other servers never see us
// come and go. The app webviews have no Push API, so web push servers need it too.
export function needsHistoryPoll(server: Server): boolean {
  if (server.isBouncerControl) return false;
  return server.persistenceEffective === "ON" || !!server.bouncerNetid;
}

function addressOf(saved: ServerConfig): string {
  if (!saved.host.includes("://")) return `wss://${saved.host}:${saved.port}`;
  try {
    // We upgrade ws:// to wss:// as the live connection does.
    const url = new URL(saved.host.replace(/^ws:\/\//, "wss://"));
    if (!url.port && saved.port) url.port = String(saved.port);
    return url.toString().replace(/\/$/, "");
  } catch {
    return saved.host;
  }
}

function decodedPassword(saved: ServerConfig): string | undefined {
  if (!saved.saslPassword) return undefined;
  try {
    return atob(saved.saslPassword);
  } catch {
    return undefined;
  }
}

export function historyPollConfigFor(
  servers: Server[],
  saved: ServerConfig[],
  settings: GlobalSettings,
  live: LiveServerState,
  since: number,
): HistoryPollConfig | null {
  if (!areChatNotificationsOn(settings)) return null;
  const entries: HistoryPollServer[] = [];
  for (const server of servers) {
    if (!needsHistoryPoll(server)) continue;
    const configId = server.bouncerServerId ?? server.id;
    const config = saved.find((s) => s.id === configId);
    if (!config) continue;
    const account = config.saslEnabled
      ? config.saslAccountName || config.nickname
      : undefined;
    entries.push({
      id: server.id,
      address: addressOf(config),
      nick: live.nickOf(server.id) ?? config.nickname,
      account: account || undefined,
      password: account ? decodedPassword(config) : undefined,
      serverPassword: config.password || undefined,
      bouncerNetid: server.bouncerNetid,
      customMentions: settings.customMentions,
      ignoreList: settings.ignoreList,
      since,
    });
  }
  if (entries.length === 0) return null;
  return {
    servers: entries,
    strings: {
      channelTitle: notificationTitle({
        sender: "{sender}",
        target: "{target}",
        isPrivate: false,
      }),
      encryptedBody: encryptedNotificationText(),
    },
  };
}

let lastSent: string | null | undefined;

export async function configureHistoryPoll(
  config: HistoryPollConfig | null,
): Promise<void> {
  if (!isTauriMobile()) return;
  const payload = config ? JSON.stringify(config) : null;
  if (payload === lastSent) return;
  const previous = lastSent;
  // Startup changes the store many times before the first call returns, so we mark the payload sent up front.
  lastSent = payload;
  await invoke("plugin:mobile-notifications|configure_history_poll", {
    config: payload,
    intervalMinutes: HISTORY_POLL_INTERVAL_MINUTES,
  }).catch((error) => {
    lastSent = previous;
    throw error;
  });
}
