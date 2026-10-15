import { beforeEach, describe, expect, it, vi } from "vitest";

const webpush = vi.hoisted(() => ({
  hasWebPush: vi.fn(() => true),
  registerWebPush: vi.fn(async () => {}),
  unregisterWebPush: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/webpush", () => webpush);

import useStore from "../../src/store";
import type { Server } from "../../src/types";

const pushServer = {
  id: "push-1",
  name: "PushNet",
  isConnected: true,
  vapidKey: "BKey",
  channels: [],
  privateChats: [],
  users: [],
} as unknown as Server;

describe("web push registration", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    webpush.registerWebPush.mockClear();
    webpush.unregisterWebPush.mockClear();
    useStore.setState((state) => ({
      servers: [],
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: false,
        notificationVolume: 0.4,
      },
    }));
  });

  it("registers once the server is connected with a key and notifications are on", () => {
    useStore.setState((state) => ({
      servers: [pushServer],
      globalSettings: { ...state.globalSettings, enableNotifications: true },
    }));
    useStore.setState({ servers: [{ ...pushServer }] });

    expect(webpush.registerWebPush).toHaveBeenCalledTimes(1);
    expect(webpush.registerWebPush).toHaveBeenCalledWith("push-1", "BKey");
  });

  it("unregisters when the bell mutes notifications", () => {
    useStore.setState((state) => ({
      servers: [pushServer],
      globalSettings: { ...state.globalSettings, enableNotifications: true },
    }));
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, notificationVolume: 0 },
    }));

    expect(webpush.unregisterWebPush).toHaveBeenCalledWith("push-1");
  });
});
