import type { GlobalSettings } from "../store";
import type { User } from "../types";

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

/**
 * Show a mention notification using browser API or fallback
 */
export const showMentionNotification = async (
  serverId: string,
  channelName: string,
  sender: string,
  message: string,
  onFallback?: (serverId: string, message: string) => void,
): Promise<void> => {
  // Try browser notification first
  if (isNotificationSupported() && Notification.permission === "granted") {
    const notification = showBrowserNotification(
      `${sender} mentioned you in ${channelName}`,
      {
        body:
          message.length > 100 ? `${message.substring(0, 100)}...` : message,
        icon: "/images/obby.png",
        tag: `mention-${serverId}-${channelName}`,
        requireInteraction: false,
      },
    );

    if (notification) {
      // Successfully showed browser notification
      return;
    }
  }

  // Fallback to in-app notification
  if (onFallback) {
    onFallback(
      serverId,
      `You were mentioned by ${sender} in ${channelName}: ${message}`,
    );
  }
};
