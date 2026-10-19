import { describe, expect, it } from "vitest";
import { closedAppDelivery } from "../../src/lib/closedAppDelivery";

const base = {
  platform: "android" as const,
  areNotificationsOn: true,
  hasPushRegistration: false,
  needsHistoryPoll: false,
};

describe("closedAppDelivery", () => {
  it("says nothing arrives while notifications are off", () => {
    expect(
      closedAppDelivery({
        ...base,
        areNotificationsOn: false,
        hasPushRegistration: true,
      }),
    ).toBe("off");
  });

  it("is instant once the server has our push subscription", () => {
    expect(closedAppDelivery({ ...base, hasPushRegistration: true })).toBe(
      "instant",
    );
  });

  it("needs the app open on a server that keeps no history", () => {
    expect(closedAppDelivery(base)).toBe("while-open");
  });

  it("checks history periodically on android and only in the background on ios", () => {
    const polled = { ...base, needsHistoryPoll: true };
    expect(closedAppDelivery(polled)).toBe("periodic-check");
    expect(closedAppDelivery({ ...polled, platform: "ios" })).toBe(
      "background-only",
    );
  });
});
