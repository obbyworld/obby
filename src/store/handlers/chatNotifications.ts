import { t } from "@lingui/core/macro";
import type { StoreApi } from "zustand";
import {
  type ChatNotification,
  notificationBody,
  requestChatNotificationPermission,
  showChatNotification,
} from "../../lib/notifications";
import type { AppState } from "../index";

// We ask for permission inside the toggle's click so browsers accept the request.
export function registerNotificationPermission(
  store: StoreApi<AppState>,
): void {
  store.subscribe((state, previous) => {
    if (
      !state.globalSettings.enableNotifications ||
      previous.globalSettings.enableNotifications
    )
      return;
    void requestChatNotificationPermission().then((isGranted) => {
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

// The bell silences notifications along with the sound, so one switch quiets
// the app.
export function notifyChatMessage(
  store: StoreApi<AppState>,
  notification: ChatNotification,
): void {
  const { globalSettings } = store.getState();
  if (
    !globalSettings.enableNotifications ||
    globalSettings.notificationVolume <= 0
  )
    return;
  void showChatNotification(notification).then((isShown) => {
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
  });
}
