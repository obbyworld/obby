import { beforeEach, describe, expect, it, vi } from "vitest";

const webpush = vi.hoisted(() => ({
  hasWebPush: vi.fn(() => true),
  pushContextFor: vi.fn(() => ({ nick: "me" })),
  registerWebPush: vi.fn(async () => true),
  sendPushContext: vi.fn(),
  unregisterWebPush: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/webpush", () => webpush);
vi.mock("../../src/lib/pushRegistration", () => ({
  dropRemovedServersPush: vi.fn(async () => {}),
}));

import useStore from "../../src/store";
import type { Server } from "../../src/types";

const pushServer: Server = {
  id: "push-1",
  name: "PushNet",
  host: "irc.example.org",
  port: 6697,
  isConnected: true,
  vapidKey: "BKey",
  channels: [],
  privateChats: [],
  users: [],
};

const turnNotificationsOn = () =>
  useStore.setState((state) => ({
    servers: [pushServer],
    globalSettings: { ...state.globalSettings, enableNotifications: true },
  }));

describe("web push registration", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    for (const mock of Object.values(webpush)) mock.mockClear();
    useStore.setState((state) => ({
      servers: [],
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: false,
        notificationVolume: 0.4,
      },
    }));
  });

  it("registers once per connection", () => {
    turnNotificationsOn();
    useStore.setState({ servers: [{ ...pushServer }] });
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(1);
    expect(webpush.registerWebPush).toHaveBeenCalledWith("push-1", "BKey", {
      nick: "me",
    });

    useStore.setState({ servers: [{ ...pushServer, isConnected: false }] });
    useStore.setState({ servers: [{ ...pushServer }] });
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(2);
  });

  it("retries a registration the browser refused", async () => {
    webpush.registerWebPush.mockResolvedValueOnce(false);
    turnNotificationsOn();
    await Promise.resolve();
    useStore.setState({ servers: [{ ...pushServer }] });
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(2);
  });

  it("sends the worker a changed context without registering again", () => {
    turnNotificationsOn();
    webpush.pushContextFor.mockReturnValueOnce({ nick: "renamed" });
    useStore.setState({ servers: [{ ...pushServer }] });
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(1);
    expect(webpush.sendPushContext).toHaveBeenCalledWith("push-1", {
      nick: "renamed",
    });
  });

  it("unregisters when the bell mutes notifications", () => {
    turnNotificationsOn();
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, notificationVolume: 0 },
    }));
    expect(webpush.unregisterWebPush).toHaveBeenCalledWith("push-1", true);
  });
});
