import { t } from "@lingui/core/macro";
import { invoke } from "@tauri-apps/api/core";
import type { GlobalSettings } from "../store/types";
import type { Server, ServerConfig } from "../types";
import { isTauriMobile } from "./platformUtils";

/** Android runs periodic work at most this often; iOS decides on its own. */
export const BACKGROUND_INTERVAL_MINUTES = 15;

export interface BackgroundServer {
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

export interface BackgroundConfig {
  servers: BackgroundServer[];
  strings: { channelTitle: string; encryptedBody: string };
}

/** A server keeps messages for us while we are away: ObbyIRCd persistence, or
 *  a soju network. Only those get a background session, so plain servers never
 *  see us come and go. */
export function keepsHistoryForUs(server: Server): boolean {
  if (server.isBouncerControl) return false;
  return server.persistenceEffective === "ON" || !!server.bouncerNetid;
}

function addressOf(saved: ServerConfig): string {
  if (!saved.host.includes("://")) return `wss://${saved.host}:${saved.port}`;
  try {
    const url = new URL(saved.host);
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

/** The background check config, or null when nothing should be checked. */
export function backgroundConfigFor(
  servers: Server[],
  saved: ServerConfig[],
  settings: GlobalSettings,
  nickOf: (serverId: string) => string | undefined,
  since: number,
): BackgroundConfig | null {
  if (!settings.enableNotifications || settings.notificationVolume <= 0)
    return null;
  const entries: BackgroundServer[] = [];
  for (const server of servers) {
    if (!keepsHistoryForUs(server)) continue;
    const config = saved.find((s) => s.id === server.id);
    if (!config) continue;
    const account = config.saslEnabled ? config.saslAccountName : undefined;
    entries.push({
      id: server.id,
      address: addressOf(config),
      nick: nickOf(server.id) ?? config.nickname,
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

/** Hands the config to the native background check, skipping repeats. */
export async function configureBackgroundCheck(
  config: BackgroundConfig | null,
): Promise<void> {
  if (!isTauriMobile()) return;
  const payload = config ? JSON.stringify(config) : null;
  if (payload === lastSent) return;
  lastSent = payload;
  await invoke("plugin:mobile-notifications|configure", {
    config: payload,
    intervalMinutes: BACKGROUND_INTERVAL_MINUTES,
  });
}

/** Runs a check right away, for testing. */
export function runBackgroundCheckNow(): Promise<void> {
  return invoke("plugin:mobile-notifications|run_now");
}
