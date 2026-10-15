// History poll: the fallback for servers without web push. While the mobile app
// is closed, it logs in now and then and posts notifications for what arrived.
import { t } from "@lingui/core/macro";
import { invoke } from "@tauri-apps/api/core";
import type { GlobalSettings } from "../../store/types";
import type { Server, ServerConfig } from "../../types";
import { isTauriMobile } from "../platformUtils";

/** Android runs periodic work at most this often; iOS decides on its own. */
export const HISTORY_POLL_INTERVAL_MINUTES = 15;

const WEB_PUSH_CAPABILITIES = ["draft/webpush", "soju.im/webpush"];

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
  offersCapability: (serverId: string, capability: string) => boolean;
}

// We only poll servers that keep history for us, so other servers never see us
// come and go, and we leave servers with web push to their own notifications.
export function needsHistoryPoll(
  server: Server,
  offersCapability: LiveServerState["offersCapability"],
): boolean {
  if (server.isBouncerControl) return false;
  if (WEB_PUSH_CAPABILITIES.some((cap) => offersCapability(server.id, cap)))
    return false;
  return server.persistenceEffective === "ON" || !!server.bouncerNetid;
}

function addressOf(saved: ServerConfig): string {
  if (!saved.host.includes("://")) return `wss://${saved.host}:${saved.port}`;
  try {
    // The app upgrades ws:// too, so the password never crosses in cleartext.
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

/** The history poll config, or null when nothing needs polling. */
export function historyPollConfigFor(
  servers: Server[],
  saved: ServerConfig[],
  settings: GlobalSettings,
  live: LiveServerState,
  since: number,
): HistoryPollConfig | null {
  if (!settings.enableNotifications || settings.notificationVolume <= 0)
    return null;
  const entries: HistoryPollServer[] = [];
  for (const server of servers) {
    if (!needsHistoryPoll(server, live.offersCapability)) continue;
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
  const sender = "{sender}";
  const target = "{target}";
  return {
    servers: entries,
    strings: {
      channelTitle: t`${sender} in ${target}`,
      encryptedBody: t`New encrypted message`,
    },
  };
}

let lastSent: string | null | undefined;

/** Hands the config to the native history poll, skipping repeats. */
export async function configureHistoryPoll(
  config: HistoryPollConfig | null,
): Promise<void> {
  if (!isTauriMobile()) return;
  const payload = config ? JSON.stringify(config) : null;
  if (payload === lastSent) return;
  await invoke("plugin:mobile-notifications|configure_history_poll", {
    config: payload,
    intervalMinutes: HISTORY_POLL_INTERVAL_MINUTES,
  });
  lastSent = payload;
}
