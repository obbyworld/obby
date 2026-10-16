import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  endpointHandler: undefined as
    | ((event: {
        serverId: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }) => void)
    | undefined,
  registerNativePush: vi.fn(async () => true),
  unregisterNativePush: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/nativePush", () => ({
  registerNativePush: native.registerNativePush,
  unregisterNativePush: native.unregisterNativePush,
  onPushEndpoint: async (handler: typeof native.endpointHandler) => {
    native.endpointHandler = handler;
  },
  onPushUnregistered: async () => {},
}));
vi.mock("../../src/lib/webpush", () => ({
  hasWebPush: () => true,
  pushContextFor: () => ({ nick: "me" }),
  registerWebPush: vi.fn(async () => true),
  sendPushContext: vi.fn(),
  unregisterWebPush: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/platformUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/platformUtils")>()),
  isTauriAndroid: () => true,
}));

import ircClient from "../../src/lib/ircClient";
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

const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});

const deliver = (endpoint: string) =>
  native.endpointHandler?.({
    serverId: "push-1",
    endpoint,
    p256dh: "P",
    auth: "A",
  });

describe("native push registration", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    sendRaw.mockClear();
    native.registerNativePush.mockClear();
    native.unregisterNativePush.mockClear();
    useStore.setState((state) => ({
      servers: [],
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: true,
        notificationVolume: 0.4,
        pushMethod: "fcm",
      },
    }));
  });

  it("registers each web push server and hands the endpoint to it", () => {
    useStore.setState({ servers: [pushServer] });
    expect(native.registerNativePush).toHaveBeenCalledWith(
      "push-1",
      "BKey",
      "fcm",
      { nick: "me", serverId: "push-1", customMentions: [] },
      "PushNet",
    );

    deliver("https://fcm.googleapis.com/fcm/send/one");
    expect(sendRaw).toHaveBeenCalledWith(
      "push-1",
      "WEBPUSH REGISTER https://fcm.googleapis.com/fcm/send/one p256dh=P;auth=A",
    );
    expect(useStore.getState().servers[0].pushEndpoint).toBe(
      "https://fcm.googleapis.com/fcm/send/one",
    );
  });

  it("moves the server to the new endpoint when the method changes", () => {
    useStore.setState({ servers: [pushServer] });
    deliver("https://fcm.googleapis.com/fcm/send/one");
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, pushMethod: "unifiedpush" },
    }));
    expect(native.registerNativePush).toHaveBeenLastCalledWith(
      "push-1",
      "BKey",
      "unifiedpush",
      expect.anything(),
      "PushNet",
    );

    sendRaw.mockClear();
    deliver("https://ntfy.sh/up123");
    expect(sendRaw.mock.calls).toEqual([
      ["push-1", "WEBPUSH UNREGISTER https://fcm.googleapis.com/fcm/send/one"],
      ["push-1", "WEBPUSH REGISTER https://ntfy.sh/up123 p256dh=P;auth=A"],
    ]);
  });

  it("drops push and leaves the server to the background check", () => {
    useStore.setState({ servers: [pushServer] });
    deliver("https://ntfy.sh/up123");
    sendRaw.mockClear();
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, pushMethod: "poll" },
    }));
    expect(sendRaw).toHaveBeenCalledWith(
      "push-1",
      "WEBPUSH UNREGISTER https://ntfy.sh/up123",
    );
    expect(native.unregisterNativePush).toHaveBeenCalledWith("push-1");
    expect(useStore.getState().servers[0].pushEndpoint).toBeUndefined();
  });
});
