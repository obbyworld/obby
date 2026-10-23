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
import type { WebPushFailure } from "../../types";
import { type AppState, loadSavedServers } from "../index";

// The app webviews have no Push API, so only the browser build subscribes.
// We register once per connection, key, permission or switch change, since
// servers may expire subscriptions a client stops renewing, and the VAPID key
// arrives in ISUPPORT after the connection is ready.
export function registerWebPushHandlers(store: StoreApi<AppState>): void {
  if (isTauri()) return;
  const applied = new Map<string, string>();
  const sentContext = new Map<string, string>();
  const attempts = new Map<string, number>();
  // One server's register and unregister share a worker scope, so we run them in order.
  const pushQueues = new Map<string, Promise<unknown>>();
  let lastAttempt = 0;
  const enqueuePush = <T>(serverId: string, step: () => Promise<T>) => {
    const pending = pushQueues.get(serverId);
    const next = pending ? pending.then(step, step) : step();
    pushQueues.set(serverId, next);
    const release = () => {
      if (pushQueues.get(serverId) === next) pushQueues.delete(serverId);
    };
    next.then(release, release);
    return next;
  };
  const setPushFailure = (serverId: string, failure?: WebPushFailure) => {
    const server = store.getState().servers.find((s) => s.id === serverId);
    if (!server || server.webPushFailure === failure) return;
    store.setState((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId ? { ...s, webPushFailure: failure } : s,
      ),
    }));
  };
  const forgetServerPush = (serverId: string) => {
    applied.delete(serverId);
    sentContext.delete(serverId);
    attempts.delete(serverId);
  };
  const dropRemoved = () =>
    void dropRemovedServersPush(loadSavedServers().map((server) => server.id));
  dropRemoved();
  void dropRootPushSubscription().catch((error) =>
    console.warn("[webpush] could not drop the old subscription:", error),
  );
  const applyPushState = (state: AppState) => {
    const isOn =
      areChatNotificationsOn(state.globalSettings) &&
      state.notificationPermission === "granted";
    for (const server of state.servers) {
      if (!server.isRegistered || !server.vapidKey) {
        forgetServerPush(server.id);
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
      const serverId = server.id;
      const vapidKey = server.vapidKey;
      const attempt = ++lastAttempt;
      attempts.set(serverId, attempt);
      if (!isOn) {
        setPushFailure(serverId);
        void enqueuePush(serverId, () => unregisterWebPush(serverId, true));
        continue;
      }
      const isCurrent = () => attempts.get(serverId) === attempt;
      void enqueuePush(serverId, () =>
        registerWebPush(serverId, vapidKey, context, isCurrent),
      ).then((result) => {
        if (isCurrent())
          setPushFailure(
            serverId,
            result === "registered" ? undefined : result,
          );
      });
    }
  };
  store.subscribe((state, previous) => {
    if (
      state.servers === previous.servers &&
      state.globalSettings === previous.globalSettings &&
      state.notificationPermission === previous.notificationPermission
    )
      return;
    if (state.servers.length < previous.servers.length) {
      dropRemoved();
      for (const serverId of applied.keys())
        if (!state.servers.some((server) => server.id === serverId))
          forgetServerPush(serverId);
    }
    applyPushState(state);
  });
}
