import { beforeEach, describe, expect, it, vi } from "vitest";
import useStore from "../../src/store";

describe("the notification switch in a browser", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    useStore.setState((state) => ({
      notificationPermission: "granted",
      globalSettings: { ...state.globalSettings, enableNotifications: true },
    }));
  });

  it("turns off when the browser takes the permission back", () => {
    vi.stubGlobal("Notification", { permission: "default" });
    useStore.getState().syncNotificationPermission();

    expect(useStore.getState().globalSettings.enableNotifications).toBe(false);
  });

  it("stays on while the permission holds", () => {
    useStore.getState().syncNotificationPermission();

    expect(useStore.getState().globalSettings.enableNotifications).toBe(true);
  });
});
