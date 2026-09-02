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

/**
 * Check if a message contains a mention for the current user
 */
export const checkForMention = (
  messageContent: string,
  currentUser: User | null,
  globalSettings: GlobalSettings,
): boolean => {
  if (!currentUser) return false;

  const content = messageContent.toLowerCase();

  // Check for username mention
  const usernameMention = content.includes(currentUser.username.toLowerCase());

  // Check for custom mentions
  const customMention = globalSettings.customMentions.some(
    (mention: string) =>
      mention.trim() && content.includes(mention.toLowerCase()),
  );

  return usernameMention || customMention;
};

/**
 * Extract mentioned users from a message
 */
export const extractMentions = (
  messageContent: string,
  currentUser: User | null,
  globalSettings: GlobalSettings,
): string[] => {
  const mentions: string[] = [];

  if (!currentUser) return mentions;

  const content = messageContent.toLowerCase();

  // Check for username mention
  if (content.includes(currentUser.username.toLowerCase())) {
    mentions.push(currentUser.username);
  }

  // Check for custom mentions
  for (const mention of globalSettings.customMentions) {
    if (mention.trim() && content.includes(mention.toLowerCase())) {
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
