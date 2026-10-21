import { beforeEach, describe, expect, it, vi } from "vitest";

const webpush = vi.hoisted(() => ({
  hasWebPush: vi.fn(() => true),
  pushContextFor: vi.fn(() => ({ nick: "me" })),
  registerWebPush: vi.fn<
    (
      serverId: string,
      vapidKey: string,
      context: object,
      isCurrent: () => boolean,
    ) => Promise<"registered" | "failed" | "timed-out">
  >(async () => "registered"),
  sendPushContext: vi.fn(),
  unregisterWebPush: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/webpush", () => webpush);
vi.mock("../../src/lib/pushRegistration", () => ({
  dropRemovedServersPush: vi.fn(async () => {}),
  dropRootPushSubscription: vi.fn(async () => {}),
}));

import useStore from "../../src/store";
import type { Server } from "../../src/types";

const pushServer: Server = {
  id: "push-1",
  name: "PushNet",
  host: "irc.example.org",
  port: 6697,
  isConnected: true,
  isRegistered: true,
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
      notificationPermission: "granted",
      failedWebPushServers: [],
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: false,
        notificationVolume: 0.4,
      },
    }));
  });

  it("registers once per connection", async () => {
    turnNotificationsOn();
    useStore.setState({ servers: [{ ...pushServer }] });
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(1);
    expect(webpush.registerWebPush).toHaveBeenCalledWith(
      "push-1",
      "BKey",
      { nick: "me" },
      expect.any(Function),
    );

    useStore.setState({
      servers: [{ ...pushServer, isConnected: false, isRegistered: false }],
    });
    useStore.setState({ servers: [{ ...pushServer }] });
    await vi.waitFor(() =>
      expect(webpush.registerWebPush).toHaveBeenCalledTimes(2),
    );
  });

  it("waits for the server to welcome us before it registers", async () => {
    turnNotificationsOn();
    webpush.registerWebPush.mockClear();
    useStore.setState({
      servers: [{ ...pushServer, isConnected: false, isRegistered: false }],
    });
    useStore.setState({ servers: [{ ...pushServer, isRegistered: false }] });
    expect(webpush.registerWebPush).not.toHaveBeenCalled();

    useStore.setState({ servers: [{ ...pushServer }] });
    await vi.waitFor(() =>
      expect(webpush.registerWebPush).toHaveBeenCalledTimes(1),
    );
  });

  it("reports why a registration failed until the next connection retries it", async () => {
    webpush.registerWebPush.mockResolvedValueOnce("timed-out");
    turnNotificationsOn();
    await vi.waitFor(() =>
      expect(useStore.getState().servers[0].webPushFailure).toBe("timed-out"),
    );
    useStore.setState((state) => ({ servers: [{ ...state.servers[0] }] }));
    expect(webpush.registerWebPush).toHaveBeenCalledTimes(1);

    useStore.setState({
      servers: [{ ...pushServer, isConnected: false, isRegistered: false }],
    });
    useStore.setState({ servers: [{ ...pushServer }] });
    await vi.waitFor(() =>
      expect(webpush.registerWebPush).toHaveBeenCalledTimes(2),
    );
  });

  it("ignores a registration result that arrives after the switch went off", async () => {
    let finish: (result: "failed") => void = () => {};
    webpush.registerWebPush.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    turnNotificationsOn();
    const [, , , isCurrent] = webpush.registerWebPush.mock.calls[0];
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, enableNotifications: false },
    }));
    finish("failed");
    await Promise.resolve();
    expect(isCurrent()).toBe(false);
    expect(useStore.getState().servers[0].webPushFailure).toBeUndefined();
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

  it("registers once the user allows the prompt the switch opened", async () => {
    const notification = {
      permission: "default",
      requestPermission: vi.fn(async () => {
        notification.permission = "granted";
        return "granted";
      }),
    };
    vi.stubGlobal("Notification", notification);
    useStore.setState({ notificationPermission: "default" });
    turnNotificationsOn();
    expect(webpush.registerWebPush).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(webpush.registerWebPush).toHaveBeenCalledWith(
        "push-1",
        "BKey",
        { nick: "me" },
        expect.any(Function),
      ),
    );
  });

  it("unregisters when the bell mutes notifications", async () => {
    turnNotificationsOn();
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, notificationVolume: 0 },
    }));
    await vi.waitFor(() =>
      expect(webpush.unregisterWebPush).toHaveBeenCalledWith("push-1", true),
    );
  });
});
