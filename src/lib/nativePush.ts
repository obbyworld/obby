import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type { PushMethod } from "../store/types";
import type { PushContext } from "./webpush";

const PLUGIN = "mobile-notifications";

export type NativePushMode = Exclude<PushMethod, "poll">;

export interface NativePushContext extends PushContext {
  serverId: string;
  customMentions: string[];
}

export interface PushStatus {
  isFcmAvailable: boolean;
  distributors: { id: string; name: string }[];
  /** The UnifiedPush distributor in use, if one is picked. */
  current?: string;
}

export interface PushEndpoint {
  serverId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const pushStatus = () =>
  invoke<PushStatus>(`plugin:${PLUGIN}|push_status`);

export const pickPushDistributor = () =>
  invoke<PushStatus>(`plugin:${PLUGIN}|pick_push_distributor`);

/** Resolves false when the mode has no distributor on this device. The
 *  endpoint arrives later through `onPushEndpoint`. */
export async function registerNativePush(
  serverId: string,
  vapidKey: string,
  mode: NativePushMode,
  context: NativePushContext,
  label: string,
): Promise<boolean> {
  const { isRegistered } = await invoke<{ isRegistered: boolean }>(
    `plugin:${PLUGIN}|register_push`,
    { serverId, vapidKey, mode, context: JSON.stringify(context), label },
  );
  return isRegistered;
}

export const unregisterNativePush = (serverId: string) =>
  invoke<void>(`plugin:${PLUGIN}|unregister_push`, { serverId });

export const onPushEndpoint = (handler: (endpoint: PushEndpoint) => void) =>
  addPluginListener(PLUGIN, "pushEndpoint", handler);

export const onPushUnregistered = (
  handler: (event: { serverId: string }) => void,
) => addPluginListener(PLUGIN, "pushUnregistered", handler);
