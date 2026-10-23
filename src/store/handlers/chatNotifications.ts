import { t } from "@lingui/core/macro";
import type { StoreApi } from "zustand";
import {
  areChatNotificationsOn,
  type ChatNotification,
  notificationBody,
  requestChatNotificationPermission,
  showChatNotification,
} from "../../lib/notifications";
import { isTauri } from "../../lib/platformUtils";
import type { AppState } from "../index";
import { settings as settingsStorage } from "../localStorage";

// A browser that has not granted permission shows nothing, so we keep its
// switch off and flipping it on asks again.
function turnOffWithoutPermission(state: AppState, store: StoreApi<AppState>) {
  if (
    !isTauri() &&
    state.globalSettings.enableNotifications &&
    state.notificationPermission !== null &&
    state.notificationPermission !== "granted"
  )
    store.getState().updateGlobalSettings({ enableNotifications: false });
}

// The browser can change the permission from its site settings, so we follow
// its change event and look again whenever the window comes back.
function watchNotificationPermission(store: StoreApi<AppState>) {
  const sync = () => store.getState().syncNotificationPermission();
  sync();
  turnOffWithoutPermission(store.getState(), store);
  globalThis.addEventListener?.("focus", sync);
  void navigator.permissions
    ?.query({ name: "notifications" })
    .then((status) => status.addEventListener("change", sync))
    .catch((error: unknown) =>
      console.warn("could not watch the notification permission:", error),
    );
}

// We ask for permission inside the toggle's click so browsers accept the request.
export function registerNotificationPermission(
  store: StoreApi<AppState>,
): void {
  watchNotificationPermission(store);
  store.subscribe((state, previous) => {
    if (state.notificationPermission !== previous.notificationPermission)
      turnOffWithoutPermission(state, store);
    if (
      !state.globalSettings.enableNotifications ||
      previous.globalSettings.enableNotifications
    )
      return;
    void requestChatNotificationPermission().then((isGranted) => {
      store.getState().syncNotificationPermission();
      if (isGranted) return;
      store.getState().updateGlobalSettings({ enableNotifications: false });
      store.getState().addGlobalNotification({
        type: "note",
        command: "NOTIFICATIONS",
        code: "PERMISSION_DENIED",
        message: t`Allow notifications for Obby in your system settings to turn them on`,
        serverId: store.getState().ui.selectedServerId ?? "",
      });
    });
  });
}

// The apps ask on a fresh install only, so we keep whatever an existing user
// chose; browsers accept the request only from a click.
export function offerNotificationsOnce(store: StoreApi<AppState>): void {
  if (!isTauri() || "enableNotifications" in settingsStorage.load()) return;
  void requestChatNotificationPermission().then((isGranted) => {
    store.getState().updateGlobalSettings({ enableNotifications: isGranted });
  });
}

function isWindowInUse(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function notifyChatMessage(
  store: StoreApi<AppState>,
  notification: ChatNotification,
  isChatOpen: boolean,
): void {
  if (!areChatNotificationsOn(store.getState().globalSettings)) return;
  if (isChatOpen && isWindowInUse()) return;
  void showChatNotification(notification)
    .then((isShown) => {
      if (isShown) return;
      const { sender, target, isPrivate, serverId } = notification;
      const body = notificationBody(notification.text);
      store.getState().addGlobalNotification({
        type: "note",
        command: isPrivate ? "PRIVMSG" : "MENTION",
        code: isPrivate ? "DM" : "HIGHLIGHT",
        message: isPrivate
          ? t`${sender} sent you a message: ${body}`
          : t`${sender} mentioned you in ${target}: ${body}`,
        serverId,
      });
    })
    .catch((error) =>
      console.warn("could not show a chat notification", error),
    );
}
