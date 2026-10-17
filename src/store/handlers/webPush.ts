import type { StoreApi } from "zustand";
import { areChatNotificationsOn } from "../../lib/notifications";
import { isTauri } from "../../lib/platformUtils";
import {
  dropRemovedServersPush,
  dropRootPushSubscription,
} from "../../lib/pushRegistration";
import {
  hasWebPush,
  pushContextFor,
  registerWebPush,
  sendPushContext,
  unregisterWebPush,
} from "../../lib/webpush";
import { type AppState, loadSavedServers } from "../index";

const PROMPT_POLL_MS = 500;
const PROMPT_WAIT_MS = 120_000;

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
  void dropRootPushSubscription().catch((error) =>
    console.warn("[webpush] could not drop the old subscription:", error),
  );
  const applyPushState = (state: AppState) => {
    const isOn =
      areChatNotificationsOn(state.globalSettings) &&
      globalThis.Notification?.permission === "granted";
    for (const server of state.servers) {
      if (!server.isConnected || !server.vapidKey) {
        applied.delete(server.id);
        sentContext.delete(server.id);
        continue;
      }
      if (!hasWebPush(server.id)) continue;
      const context = pushContextFor(server.id, state.globalSettings);
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
  };
  store.subscribe((state, previous) => {
    if (
      state.servers === previous.servers &&
      state.globalSettings === previous.globalSettings
    )
      return;
    if (state.servers.length < previous.servers.length) {
      dropRemoved();
      for (const serverId of applied.keys()) {
        if (state.servers.some((server) => server.id === serverId)) continue;
        applied.delete(serverId);
        sentContext.delete(serverId);
      }
    }
    applyPushState(state);
    if (
      areChatNotificationsOn(state.globalSettings) &&
      !areChatNotificationsOn(previous.globalSettings)
    )
      applyOnceAnswered();
  });
  // The switch flips before the user answers the permission prompt, and not
  // every browser reports the answer as an event, so we look until it lands.
  let answerTimer: ReturnType<typeof setInterval> | undefined;
  const applyOnceAnswered = () => {
    clearInterval(answerTimer);
    const startedAt = Date.now();
    answerTimer = setInterval(() => {
      const permission = globalThis.Notification?.permission;
      if (permission === "default" && Date.now() - startedAt < PROMPT_WAIT_MS)
        return;
      clearInterval(answerTimer);
      if (permission === "granted") applyPushState(store.getState());
    }, PROMPT_POLL_MS);
  };
}
