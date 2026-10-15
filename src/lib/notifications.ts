import { t } from "@lingui/core/macro";
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
import { isTauri, isTauriAndroid } from "./platformUtils";

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

/** Where a tapped notification takes the user. */
export type NotificationTarget = Pick<
  ChatNotification,
  "serverId" | "target" | "time" | "msgid"
>;

export const ANDROID_MESSAGES_CHANNEL = "messages";
const BODY_LIMIT = 200;

const chatKey = (serverId: string, target: string) =>
  `${serverId}:${target.toLowerCase()}`;

// One id per chat, so a new message in the same chat replaces its notification.
export function notificationIdFor(serverId: string, target: string): number {
  let hash = 0;
  for (const char of chatKey(serverId, target))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return hash;
}

export function notificationTitle(notification: ChatNotification): string {
  return notification.isPrivate
    ? notification.sender
    : t`${notification.sender} in ${notification.target}`;
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
    sendNotification({
      id: notificationIdFor(notification.serverId, notification.target),
      title,
      body,
      group: chatKey(notification.serverId, notification.target),
      channelId: isTauriAndroid() ? ANDROID_MESSAGES_CHANNEL : undefined,
      extra: { ...target },
    });
    return true;
  }
  const shown = showBrowserNotification(title, {
    body,
    icon: "/images/obby.png",
    tag: chatKey(notification.serverId, notification.target),
  });
  if (!shown) return false;
  const key = chatKey(notification.serverId, notification.target);
  webNotifications.set(key, shown);
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
  if (isTauri())
    removeActive([{ id: notificationIdFor(serverId, target) }]).catch(() => {});
}

const isNotificationTarget = (
  extra: Record<string, unknown> | undefined,
): extra is NotificationTarget =>
  typeof extra?.serverId === "string" &&
  typeof extra.target === "string" &&
  typeof extra.time === "number";

/** Routes a tapped notification to its chat. We register the native listener
 *  before the first notification goes out, since desktop only reports taps on
 *  notifications shown while a listener existed. */
export async function handleNotificationTaps(
  open: (target: NotificationTarget) => void,
): Promise<void> {
  openTarget = open;
  if (!isTauri()) return;
  if (isTauriAndroid())
    await createChannel({
      id: ANDROID_MESSAGES_CHANNEL,
      name: t`Messages`,
      importance: Importance.High,
    });
  await onAction(({ actionId, notification }) => {
    const extra = notification?.extra;
    if (actionId === "tap" && isNotificationTarget(extra)) open(extra);
  });
}

/** Asks the platform for permission to show notifications. */
export async function requestChatNotificationPermission(): Promise<boolean> {
  if (isTauri())
    return (
      (await isPermissionGranted()) || (await requestPermission()) === "granted"
    );
  return (await requestNotificationPermission()) === "granted";
}
