import { t } from "@lingui/core/macro";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import {
  createChannel,
  Importance,
  isPermissionGranted,
  onAction,
  removeActive,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { GlobalSettings } from "../store";
import type { User } from "../types";
import { stripIrcFormatting } from "./messageFormatter";
import {
  isTauri,
  isTauriAndroid,
  isTauriIOS,
  isTauriMobile,
} from "./platformUtils";
import {
  closePushNotifications,
  markShownByPage,
  showOnPushWorker,
} from "./pushRegistration";

/**
 * Check if the browser Notification API is supported
 */
export const isNotificationSupported = (): boolean => {
  return "Notification" in window;
};

/**
 * Request notification permission from the browser
 */
export const requestNotificationPermission =
  async (): Promise<NotificationPermission> => {
    if (!isNotificationSupported()) {
      return "denied";
    }

    if (Notification.permission === "granted") {
      return "granted";
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      return "denied";
    }
  };

/**
 * Show a browser notification
 */
export const showBrowserNotification = (
  title: string,
  options?: NotificationOptions,
): Notification | null => {
  if (!isNotificationSupported()) {
    return null;
  }

  if (Notification.permission !== "granted") {
    return null;
  }

  try {
    return new Notification(title, options);
  } catch (error) {
    console.error("Error showing notification:", error);
    return null;
  }
};

/** What a nick may be made of, per RFC 2812 plus the dash. A name is only being
 *  addressed when nothing on either side of it could be part of the name, which
 *  is what lets "mattf:" and "@mattf" count while "mattfoo" does not. */
const NICK_CHARACTER = /[A-Za-z0-9[\]\\`_^{}|-]/;

function standsAlone(content: string, at: number, length: number): boolean {
  const before = content[at - 1];
  const after = content[at + length];
  return (
    (before === undefined || !NICK_CHARACTER.test(before)) &&
    (after === undefined || !NICK_CHARACTER.test(after))
  );
}

/** Where `name` is next addressed in `content` at or after `from`, or -1 when
 *  it only appears inside longer words. */
export const findAddressedName = (
  content: string,
  name: string,
  from = 0,
): number => {
  const needle = name.trim().toLowerCase();
  if (!needle) return -1;
  const haystack = content.toLowerCase();
  for (
    let at = haystack.indexOf(needle, from);
    at !== -1;
    at = haystack.indexOf(needle, at + 1)
  ) {
    if (standsAlone(haystack, at, needle.length)) return at;
  }
  return -1;
};

/** Whether `name` is being addressed in `content` rather than sitting inside a
 *  longer word. */
export const addressesName = (content: string, name: string): boolean =>
  findAddressedName(content, name) !== -1;

/**
 * Check if a message contains a mention for the current user
 */
export const checkForMention = (
  messageContent: string,
  currentUser: User | null,
  globalSettings: GlobalSettings,
): boolean => {
  if (!currentUser) return false;

  return (
    addressesName(messageContent, currentUser.username) ||
    globalSettings.customMentions.some((mention: string) =>
      addressesName(messageContent, mention),
    )
  );
};

export const extractMentions = (
  messageContent: string,
  currentUser: User | null,
  globalSettings: GlobalSettings,
): string[] => {
  const mentions: string[] = [];

  if (!currentUser) return mentions;

  if (addressesName(messageContent, currentUser.username)) {
    mentions.push(currentUser.username);
  }

  for (const mention of globalSettings.customMentions) {
    if (addressesName(messageContent, mention)) {
      mentions.push(mention);
    }
  }

  return mentions;
};

// The bell silences notifications along with the sound, so one switch quiets the app.
export function areChatNotificationsOn(settings: GlobalSettings): boolean {
  return settings.enableNotifications && settings.notificationVolume > 0;
}

export interface ChatNotification {
  serverId: string;
  /** The channel name, or the nick of a private chat. */
  target: string;
  sender: string;
  text: string;
  isPrivate: boolean;
  time: number;
  msgid?: string;
}

export type NotificationTarget = Pick<
  ChatNotification,
  "serverId" | "target" | "time" | "msgid"
>;

const ANDROID_MESSAGES_CHANNEL = "messages";
const BODY_LIMIT = 200;
const TAP_REPEAT_MS = 3000;

const CHAT_ICON = "/pwa/icon-192.png";

const chatKey = (serverId: string, target: string) =>
  `${serverId}:${target.toLowerCase()}`;

// One id per chat, so a new message in the same chat replaces its notification.
export function notificationIdFor(serverId: string, target: string): number {
  const key = chatKey(serverId, target);
  let hash = 0;
  for (let index = 0; index < key.length; index++)
    hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  return hash;
}

export function notificationTitle({
  sender,
  target,
  isPrivate,
}: Pick<ChatNotification, "sender" | "target" | "isPrivate">): string {
  return isPrivate ? sender : t`${sender} in ${target}`;
}

export function encryptedNotificationText(): string {
  return t`New encrypted message`;
}

/** The wording a background notifier needs, since it has no catalog. */
export function backgroundNotificationStrings(): {
  channelTitle: string;
  encryptedBody: string;
} {
  return {
    channelTitle: notificationTitle({
      sender: "{sender}",
      target: "{target}",
      isPrivate: false,
    }),
    encryptedBody: encryptedNotificationText(),
  };
}

export function notificationBody(text: string): string {
  const plain = stripIrcFormatting(text).trim();
  return plain.length > BODY_LIMIT
    ? `${plain.slice(0, BODY_LIMIT - 1)}…`
    : plain;
}

const webNotifications = new Map<string, Notification>();
let openTarget: ((target: NotificationTarget) => void) | undefined;

/** Shows a chat notification through the platform's notification center.
 *  Returns false when the user has not granted permission. */
export async function showChatNotification(
  notification: ChatNotification,
): Promise<boolean> {
  const title = notificationTitle(notification);
  const body = notificationBody(notification.text);
  const target: NotificationTarget = {
    serverId: notification.serverId,
    target: notification.target,
    time: notification.time,
    msgid: notification.msgid,
  };
  if (isTauri()) {
    if (!(await isPermissionGranted())) return false;
    const native = {
      id: notificationIdFor(notification.serverId, notification.target),
      title,
      body,
      group: chatKey(notification.serverId, notification.target),
      // iOS drops a notification whose extra data holds anything but strings.
      extra: { ...target, time: String(target.time) },
    };
    if (isTauriAndroid())
      await invoke("plugin:mobile-notifications|show_notification", native);
    else sendNotification(native);
    return true;
  }
  const key = chatKey(notification.serverId, notification.target);
  // Chrome replaces a tagged notification only within one registration, so we
  // show through the server's push worker to let a push for the same chat replace ours.
  if (
    isNotificationSupported() &&
    Notification.permission === "granted" &&
    (await showOnPushWorker(
      notification.serverId,
      title,
      { body, icon: CHAT_ICON, badge: CHAT_ICON, tag: key, data: target },
      notification.msgid,
    ))
  )
    return true;
  const shown = showBrowserNotification(title, {
    body,
    icon: CHAT_ICON,
    tag: key,
  });
  if (!shown) return false;
  webNotifications.set(key, shown);
  markShownByPage(notification.serverId, notification.msgid);
  shown.onclick = () => {
    window.focus();
    openTarget?.(target);
    shown.close();
  };
  shown.onclose = () => {
    if (webNotifications.get(key) === shown) webNotifications.delete(key);
  };
  return true;
}

/** Takes back a chat's notification once it was read, here or on another of
 *  the user's clients. macOS and Windows keep delivered ones regardless. */
export function closeChatNotification(serverId: string, target: string): void {
  const key = chatKey(serverId, target);
  webNotifications.get(key)?.close();
  webNotifications.delete(key);
  if (!isTauri()) closePushNotifications(serverId, key);
  if (isTauri())
    removeActive([{ id: notificationIdFor(serverId, target) }]).catch(() => {});
}

// We post the time as a string and the background check posts it as a number.
function parseNotificationTarget(
  extra?: Record<string, unknown> | null,
): NotificationTarget | null {
  const time = Number(extra?.time);
  if (
    typeof extra?.serverId !== "string" ||
    typeof extra.target !== "string" ||
    !Number.isFinite(time)
  )
    return null;
  return {
    serverId: extra.serverId,
    target: extra.target,
    time,
    msgid: typeof extra.msgid === "string" ? extra.msgid : undefined,
  };
}

/** Routes a tapped notification to its chat. We register the native listener
 *  before the first notification goes out, since desktop only reports taps on
 *  notifications shown while a listener existed. */
export async function handleNotificationTaps(
  route: (target: NotificationTarget) => void,
): Promise<void> {
  // A cold start on Android can report one tap twice, once per plugin.
  let lastKey = "";
  let lastAt = 0;
  const open = (extra?: Record<string, unknown> | null) => {
    const target = parseNotificationTarget(extra);
    if (!target) return;
    const key = `${target.serverId}:${target.target}:${target.msgid ?? target.time}`;
    if (key === lastKey && Date.now() - lastAt < TAP_REPEAT_MS) return;
    lastKey = key;
    lastAt = Date.now();
    route(target);
  };
  openTarget = route;
  if (!isTauri()) {
    handleServiceWorkerTaps(open);
    return;
  }
  if (isTauriMobile()) await handleMobileLaunchTaps(open);
  if (isTauriAndroid())
    await createChannel({
      id: ANDROID_MESSAGES_CHANNEL,
      name: t`Messages`,
      importance: Importance.High,
    });
  await onAction(({ actionId, notification }) => {
    if (actionId === "tap") open(notification?.extra);
  });
}

const NOTIFICATION_QUERY = "obbyNotification";

// The service worker shows web push notifications; a click reaches us as a
// message, or as a query parameter on the window it opened.
function handleServiceWorkerTaps(
  open: (extra?: Record<string, unknown> | null) => void,
): void {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "obby-notification-tap") open(event.data.target);
  });
  const url = new URL(window.location.href);
  const tapped = url.searchParams.get(NOTIFICATION_QUERY);
  if (tapped === null) return;
  url.searchParams.delete(NOTIFICATION_QUERY);
  window.history.replaceState(null, "", url);
  try {
    open(JSON.parse(tapped));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

// The mobile plugin keeps the tap that launched the app, since the
// notification plugin reports it before our listener exists, and on iOS it
// reports every tap.
async function handleMobileLaunchTaps(
  open: (extra?: Record<string, unknown> | null) => void,
): Promise<void> {
  const launched = await invoke<{ target: Record<string, unknown> | null }>(
    "plugin:mobile-notifications|take_launch_target",
  ).catch((error) => {
    console.warn("could not read the notification that opened the app", error);
    return null;
  });
  open(launched?.target);
  await addPluginListener("mobile-notifications", "notificationTapped", open);
}

const PERMISSION_POLL_MS = 1000;
const PERMISSION_POLL_ATTEMPTS = 60;

// iOS refuses a request while an earlier page's prompt is still open, so we wait for that answer.
async function iosPermissionAfterOpenPrompt(): Promise<boolean> {
  for (let attempt = 0; attempt < PERMISSION_POLL_ATTEMPTS; attempt++) {
    const isGranted = await invoke<boolean | null>(
      "plugin:notification|is_permission_granted",
    );
    if (isGranted !== null) return isGranted;
    await new Promise((resolve) => setTimeout(resolve, PERMISSION_POLL_MS));
  }
  return false;
}

export async function requestChatNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return (await requestNotificationPermission()) === "granted";
  if (
    (await isPermissionGranted()) ||
    (await requestPermission()) === "granted"
  )
    return true;
  return isTauriIOS() && iosPermissionAfterOpenPrompt();
}
