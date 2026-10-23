import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  type NativePushContext,
  onPushEndpoint,
  onPushUnregistered,
  type PushEndpoint,
  pushInstances,
  registerNativePush,
  unregisterNativePush,
} from "../../lib/nativePush";
import { areChatNotificationsOn } from "../../lib/notifications";
import { isTauriAndroid } from "../../lib/platformUtils";
import { hasWebPush, pushContextFor } from "../../lib/webpush";
import { type AppState, loadSavedServers } from "../index";
import type { GlobalSettings } from "../types";

function nativePushContext(
  serverId: string,
  settings: GlobalSettings,
): NativePushContext {
  return { ...pushContextFor(serverId, settings), serverId };
}

// The Android app registers a UnifiedPush endpoint (its embedded FCM
// distributor, or a distributor app the user picked) with each server that
// offers web push, the same way a browser does. We register once per
// connection, mode, key or context change; the endpoint arrives as an event.
export function registerNativePushHandlers(store: StoreApi<AppState>): void {
  if (!isTauriAndroid()) return;
  const applied = new Map<string, string>();
  const setEndpoint = (serverId: string, endpoint: string | undefined) =>
    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId ? { ...server, pushEndpoint: endpoint } : server,
      ),
    }));

  const useEndpoint = ({ serverId, endpoint, p256dh, auth }: PushEndpoint) => {
    const server = store.getState().servers.find((s) => s.id === serverId);
    if (!server?.isRegistered) return;
    if (server.pushEndpoint && server.pushEndpoint !== endpoint)
      ircClient.sendRaw(serverId, `WEBPUSH UNREGISTER ${server.pushEndpoint}`);
    ircClient.sendRaw(
      serverId,
      `WEBPUSH REGISTER ${endpoint} p256dh=${p256dh};auth=${auth}`,
    );
    setEndpoint(serverId, endpoint);
  };
  void onPushEndpoint(useEndpoint).catch((error) =>
    console.warn("push endpoint listener failed", error),
  );
  // A distributor that dropped us will not push again, so we take the endpoint
  // back from the server and register anew.
  void onPushUnregistered(({ serverId, isFailed }) => {
    const server = store.getState().servers.find((s) => s.id === serverId);
    if (server?.isRegistered && server.pushEndpoint)
      ircClient.sendRaw(serverId, `WEBPUSH UNREGISTER ${server.pushEndpoint}`);
    if (!isFailed) applied.delete(serverId);
    setEndpoint(serverId, undefined);
  }).catch((error) => console.warn("push unregister listener failed", error));

  // Servers removed, or notifications turned off, while the app was closed or
  // offline still hold a registration on the device, so we drop those.
  let prunedFor: string | undefined;
  const pruneInstances = (state: AppState) => {
    const isOn =
      areChatNotificationsOn(state.globalSettings) &&
      state.globalSettings.pushMethod !== "poll";
    const serverIds = state.servers.map((server) => server.id);
    const key = JSON.stringify([isOn, serverIds]);
    if (prunedFor === key) return;
    prunedFor = key;
    const kept = new Set(
      isOn
        ? [...serverIds, ...loadSavedServers().map((server) => server.id)]
        : [],
    );
    void pushInstances()
      .then((instances) => {
        for (const serverId of instances)
          if (!kept.has(serverId)) void unregisterNativePush(serverId);
      })
      .catch((error) => console.warn("push cleanup failed", error));
  };
  pruneInstances(store.getState());

  store.subscribe((state, previous) => {
    if (
      state.servers === previous.servers &&
      state.globalSettings === previous.globalSettings
    )
      return;
    pruneInstances(state);
    const mode = state.globalSettings.pushMethod;
    const isOn =
      areChatNotificationsOn(state.globalSettings) && mode !== "poll";
    for (const serverId of applied.keys()) {
      if (state.servers.some((server) => server.id === serverId)) continue;
      applied.delete(serverId);
      void unregisterNativePush(serverId);
    }
    for (const server of state.servers) {
      if (!server.isRegistered) {
        applied.delete(server.id);
        continue;
      }
      if (!server.vapidKey || !hasWebPush(server.id)) continue;
      const context = nativePushContext(server.id, state.globalSettings);
      const wanted = JSON.stringify([isOn, mode, server.vapidKey, context]);
      if (applied.get(server.id) === wanted) continue;
      applied.set(server.id, wanted);
      if (mode === "poll" || !isOn) {
        if (server.pushEndpoint) {
          ircClient.sendRaw(
            server.id,
            `WEBPUSH UNREGISTER ${server.pushEndpoint}`,
          );
          setEndpoint(server.id, undefined);
        }
        void unregisterNativePush(server.id);
        continue;
      }
      const serverId = server.id;
      void registerNativePush(
        serverId,
        server.vapidKey,
        mode,
        context,
        server.name,
      )
        .then(({ endpoint }) => {
          const current = store
            .getState()
            .servers.find((s) => s.id === serverId);
          if (endpoint && current?.pushEndpoint !== endpoint.endpoint)
            useEndpoint({ serverId, ...endpoint });
        })
        .catch((error) => console.warn("push registration failed", error));
    }
  });
}
