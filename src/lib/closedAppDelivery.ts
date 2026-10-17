export type ClosedAppDelivery =
  | "off"
  | "instant"
  | "tray"
  | "periodic-check"
  | "background-only"
  | "while-open";

export type NotificationPlatform = "web" | "desktop" | "android" | "ios";

/** How a server's notifications reach the user once Obby is closed. */
export function closedAppDelivery({
  platform,
  areNotificationsOn,
  hasPushRegistration,
  needsHistoryPoll,
  keepsRunningInTray,
}: {
  platform: NotificationPlatform;
  areNotificationsOn: boolean;
  hasPushRegistration: boolean;
  needsHistoryPoll: boolean;
  keepsRunningInTray: boolean;
}): ClosedAppDelivery {
  if (!areNotificationsOn) return "off";
  if (hasPushRegistration) return "instant";
  if (platform === "desktop") return keepsRunningInTray ? "tray" : "while-open";
  if (!needsHistoryPoll) return "while-open";
  return platform === "android" ? "periodic-check" : "background-only";
}
