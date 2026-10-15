import type { StoreApi } from "zustand";
import { areChatNotificationsOn } from "../../lib/notifications";
import { isTauri } from "../../lib/platformUtils";
import {
  hasWebPush,
  registerWebPush,
  unregisterWebPush,
} from "../../lib/webpush";
import type { AppState } from "../index";

// The app webviews have no Push API, so only the browser build subscribes.
// We apply each server's push state once per connection, key or switch flip,
// since the VAPID key arrives in ISUPPORT after the connection is ready.
export function registerWebPushHandlers(store: StoreApi<AppState>): void {
  if (isTauri()) return;
  const applied = new Map<string, string>();
  store.subscribe((state) => {
    const isOn =
      areChatNotificationsOn(state.globalSettings) &&
      globalThis.Notification?.permission === "granted";
    for (const server of state.servers) {
      if (!server.isConnected || !server.vapidKey) {
        applied.delete(server.id);
        continue;
      }
      if (!hasWebPush(server.id)) continue;
      const wanted = `${isOn}:${server.vapidKey}`;
      if (applied.get(server.id) === wanted) continue;
      applied.set(server.id, wanted);
      if (isOn) void registerWebPush(server.id, server.vapidKey);
      else void unregisterWebPush(server.id);
    }
  });
}
