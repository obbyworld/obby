import type { StoreApi } from "zustand";
import { areChatNotificationsOn } from "../../lib/notifications";
import { isTauri } from "../../lib/platformUtils";
import { dropRemovedServersPush } from "../../lib/pushRegistration";
import {
  hasWebPush,
  pushContextFor,
  registerWebPush,
  sendPushContext,
  unregisterWebPush,
} from "../../lib/webpush";
import { type AppState, loadSavedServers } from "../index";

// The app webviews have no Push API, so only the browser build subscribes.
// We register once per connection, key or switch flip, since servers may
// expire subscriptions a client stops renewing, and the VAPID key arrives in
// ISUPPORT after the connection is ready.
export function registerWebPushHandlers(store: StoreApi<AppState>): void {
  if (isTauri()) return;
  const applied = new Map<string, string>();
  const sentContext = new Map<string, string>();
  const dropRemoved = () =>
    void dropRemovedServersPush(loadSavedServers().map((server) => server.id));
  dropRemoved();
  store.subscribe((state, previous) => {
    if (
      state.servers === previous.servers &&
      state.globalSettings === previous.globalSettings
    )
      return;
    const isOn =
      areChatNotificationsOn(state.globalSettings) &&
      globalThis.Notification?.permission === "granted";
    if (state.servers.length < previous.servers.length) {
      dropRemoved();
      for (const serverId of applied.keys()) {
        if (state.servers.some((server) => server.id === serverId)) continue;
        applied.delete(serverId);
        sentContext.delete(serverId);
      }
    }
    for (const server of state.servers) {
      if (!server.isConnected || !server.vapidKey) {
        applied.delete(server.id);
        sentContext.delete(server.id);
        continue;
      }
      if (!hasWebPush(server.id)) continue;
      const context = pushContextFor(
        server.id,
        state.globalSettings.ignoreList,
      );
      const wanted = `${isOn}:${server.vapidKey}`;
      if (applied.get(server.id) === wanted) {
        const contextJson = JSON.stringify(context);
        if (isOn && sentContext.get(server.id) !== contextJson) {
          sentContext.set(server.id, contextJson);
          sendPushContext(server.id, context);
        }
        continue;
      }
      applied.set(server.id, wanted);
      sentContext.set(server.id, JSON.stringify(context));
      if (!isOn) {
        void unregisterWebPush(server.id, true);
        continue;
      }
      const serverId = server.id;
      void registerWebPush(serverId, server.vapidKey, context).then(
        (isRegistered) => {
          if (!isRegistered) applied.delete(serverId);
        },
      );
    }
  });
}
