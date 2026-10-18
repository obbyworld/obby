export type ClosedAppDelivery =
  | "off"
  | "instant"
  | "periodic-check"
  | "background-only"
  | "while-open";

/** How a server's notifications reach the user once the mobile app is closed. */
export function closedAppDelivery({
  platform,
  areNotificationsOn,
  hasPushRegistration,
  needsHistoryPoll,
}: {
  platform: "android" | "ios";
  areNotificationsOn: boolean;
  hasPushRegistration: boolean;
  needsHistoryPoll: boolean;
}): ClosedAppDelivery {
  if (!areNotificationsOn) return "off";
  if (hasPushRegistration) return "instant";
  if (!needsHistoryPoll) return "while-open";
  return platform === "android" ? "periodic-check" : "background-only";
}
