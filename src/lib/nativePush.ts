import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type { PushMethod } from "../store/types";
import type { PushContext } from "./webpush";

const PLUGIN = "mobile-notifications";

export type NativePushMode = Exclude<PushMethod, "poll">;

export interface NativePushContext extends PushContext {
  serverId: string;
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

export interface NativePushRegistration {
  /** False when the mode has no distributor on this device. */
  isRegistered: boolean;
  /** The last endpoint the distributor gave, also while no page listened.
   *  A new one arrives later through `onPushEndpoint`. */
  endpoint?: Omit<PushEndpoint, "serverId"> | null;
}

export const registerNativePush = (
  serverId: string,
  vapidKey: string,
  mode: NativePushMode,
  context: NativePushContext,
  label: string,
) =>
  invoke<NativePushRegistration>(`plugin:${PLUGIN}|register_push`, {
    serverId,
    vapidKey,
    mode,
    context: JSON.stringify(context),
    label,
  });

export const unregisterNativePush = (serverId: string) =>
  invoke<void>(`plugin:${PLUGIN}|unregister_push`, { serverId });

/** The servers this device keeps a push registration for. */
export const pushInstances = async () =>
  (await invoke<{ instances: string[] }>(`plugin:${PLUGIN}|push_instances`))
    .instances;

export const onPushEndpoint = (handler: (endpoint: PushEndpoint) => void) =>
  addPluginListener(PLUGIN, "pushEndpoint", handler);

export const onPushUnregistered = (
  handler: (event: { serverId: string; isFailed?: boolean }) => void,
) => addPluginListener(PLUGIN, "pushUnregistered", handler);
