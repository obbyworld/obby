import { describe, expect, it } from "vitest";
import { closedAppDelivery } from "../../src/lib/closedAppDelivery";

const base = {
  platform: "web" as const,
  areNotificationsOn: true,
  hasPushRegistration: false,
  needsHistoryPoll: false,
  keepsRunningInTray: false,
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

  it("needs the browser open without push", () => {
    expect(closedAppDelivery(base)).toBe("while-open");
  });

  it("keeps desktop notifications coming from the tray", () => {
    expect(
      closedAppDelivery({
        ...base,
        platform: "desktop",
        keepsRunningInTray: true,
      }),
    ).toBe("tray");
    expect(closedAppDelivery({ ...base, platform: "desktop" })).toBe(
      "while-open",
    );
  });

  it("checks history periodically on android and only in the background on ios", () => {
    const polled = { ...base, needsHistoryPoll: true };
    expect(closedAppDelivery({ ...polled, platform: "android" })).toBe(
      "periodic-check",
    );
    expect(closedAppDelivery({ ...polled, platform: "ios" })).toBe(
      "background-only",
    );
    expect(closedAppDelivery({ ...base, platform: "android" })).toBe(
      "while-open",
    );
  });
});
