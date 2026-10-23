import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
  removeActive: vi.fn(async () => {}),
  createChannel: vi.fn(async () => {}),
  onAction: vi.fn(async (_listener: (event: unknown) => void) => ({
    unregister: vi.fn(),
  })),
  Importance: { High: 4 },
}));
vi.mock("@tauri-apps/plugin-notification", () => plugin);
const core = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => {}),
  addPluginListener: vi.fn(async () => ({ unregister: vi.fn() })),
}));
vi.mock("@tauri-apps/api/core", () => core);

import {
  type ChatNotification,
  closeChatNotification,
  handleNotificationTaps,
  notificationBody,
  notificationIdFor,
  notificationTitle,
  showChatNotification,
} from "../../src/lib/notifications";
import useStore from "../../src/store";
import {
  notifyChatMessage,
  offerNotificationsOnce,
} from "../../src/store/handlers/chatNotifications";

const mention: ChatNotification = {
  serverId: "s1",
  target: "#dev",
  sender: "alice",
  text: "\x02max\x02: the stream is back",
  isPrivate: false,
  time: 1_700_000_000_000,
  msgid: "m1",
};

class FakeNotification {
  static permission = "granted";
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

beforeEach(() => {
  FakeNotification.instances = [];
  FakeNotification.permission = "granted";
  vi.stubGlobal("Notification", FakeNotification);
  vi.spyOn(window, "focus").mockImplementation(() => {});
  for (const fn of Object.values(plugin))
    if (typeof fn === "function") fn.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.useRealTimers();
  vi.restoreAllMocks();
  core.invoke.mockReset();
  core.invoke.mockImplementation(async () => {});
  vi.unstubAllGlobals();
  delete (window as { __TAURI__?: unknown }).__TAURI__;
});

describe("chat notification content", () => {
  it("names the channel for mentions and only the sender for private messages", () => {
    expect(notificationTitle(mention)).toBe("alice in #dev");
    expect(notificationTitle({ ...mention, isPrivate: true })).toBe("alice");
  });

  it("strips IRC formatting and cuts long text", () => {
    expect(notificationBody(mention.text)).toBe("max: the stream is back");
    const body = notificationBody("x".repeat(500));
    expect(body).toHaveLength(200);
    expect(body.endsWith("…")).toBe(true);
  });

  it("gives each chat one id, whatever the case of its name", () => {
    expect(notificationIdFor("s1", "#Dev")).toBe(
      notificationIdFor("s1", "#dev"),
    );
    expect(notificationIdFor("s1", "#dev")).not.toBe(
      notificationIdFor("s2", "#dev"),
    );
  });

  it("matches the id the background check gives the same chat", () => {
    expect(notificationIdFor("s1", "#Dev")).toBe(441242862);
    expect(notificationIdFor("s1", "#\u{1F3AE}")).toBe(-953827591);
  });
});

describe("showing a chat notification", () => {
  it("uses the browser API on the web and routes a click to the chat", async () => {
    const open = vi.fn();
    await handleNotificationTaps(open);

    expect(await showChatNotification(mention)).toBe(true);
    const [shown] = FakeNotification.instances;
    expect(shown.title).toBe("alice in #dev");
    shown.onclick?.();

    expect(open).toHaveBeenCalledWith({
      serverId: "s1",
      target: "#dev",
      time: mention.time,
      msgid: "m1",
    });
    closeChatNotification("s1", "#DEV");
    expect(shown.close).toHaveBeenCalled();
  });

  it("shows through the server's push worker so a push for the same chat replaces it", async () => {
    const showNotification = vi.fn(async () => {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async (scope: string) => ({
          scope,
          showNotification,
          active: { postMessage: vi.fn() },
        }),
      },
    });
    expect(await showChatNotification(mention)).toBe(true);

    expect(FakeNotification.instances).toHaveLength(0);
    expect(showNotification).toHaveBeenCalledWith(
      "alice in #dev",
      expect.objectContaining({
        tag: "s1:#dev",
        data: {
          serverId: "s1",
          target: "#dev",
          time: mention.time,
          msgid: "m1",
        },
      }),
    );
  });

  it("shows its own notification while the push worker is still installing", async () => {
    const showNotification = vi.fn(async () => {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async (scope: string) => ({
          scope,
          showNotification,
          active: null,
        }),
      },
    });

    expect(await showChatNotification(mention)).toBe(true);

    expect(showNotification).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("reports a missing permission so the caller can fall back", async () => {
    FakeNotification.permission = "denied";
    expect(await showChatNotification(mention)).toBe(false);
  });

  it("goes through the native plugin in the app, grouped per chat", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    expect(await showChatNotification(mention)).toBe(true);
    expect(plugin.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notificationIdFor("s1", "#dev"),
        title: "alice in #dev",
        group: "s1:#dev",
        extra: expect.objectContaining({
          serverId: "s1",
          target: "#dev",
          time: String(mention.time),
        }),
      }),
    );
    closeChatNotification("s1", "#dev");
    expect(plugin.removeActive).toHaveBeenCalledWith([
      { id: notificationIdFor("s1", "#dev") },
    ]);
  });

  it("posts through the mobile plugin on Android so a tap carries the chat", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Linux; Android 16",
    );
    expect(await showChatNotification(mention)).toBe(true);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
    expect(core.invoke).toHaveBeenCalledWith(
      "plugin:mobile-notifications|show_notification",
      expect.objectContaining({
        id: notificationIdFor("s1", "#dev"),
        extra: expect.objectContaining({ serverId: "s1", target: "#dev" }),
      }),
    );
  });

  it("routes a web push tap that opened a new window", async () => {
    const target = { serverId: "s1", target: "#dev", time: 1, msgid: "m1" };
    window.history.pushState(
      null,
      "",
      `/?obbyNotification=${encodeURIComponent(JSON.stringify(target))}`,
    );
    const open = vi.fn();
    await handleNotificationTaps(open);

    expect(open).toHaveBeenCalledWith(target);
    expect(window.location.search).toBe("");
  });

  it("routes a native tap to the chat in its extra data", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    const open = vi.fn();
    await handleNotificationTaps(open);
    const [listener] = plugin.onAction.mock.calls[0];

    const extra = { ...mention, time: String(mention.time) };
    listener({ actionId: "tap", notification: { extra } });
    listener({ actionId: "tap", notification: { extra: {} } });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "s1",
        target: "#dev",
        time: mention.time,
      }),
    );
  });
});

describe("notifying a chat message", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    useStore.setState((state) => ({
      globalNotifications: [],
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: true,
        notificationVolume: 0.4,
      },
    }));
  });

  it("shows it when notifications are on and the bell is not muted", async () => {
    notifyChatMessage(useStore, mention, false);
    await settle();
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("stays quiet only while its chat is open in a window in use", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus");
    hasFocus.mockReturnValue(true);
    notifyChatMessage(useStore, mention, true);
    await settle();
    expect(FakeNotification.instances).toHaveLength(0);

    notifyChatMessage(useStore, mention, false);
    await settle();
    expect(FakeNotification.instances).toHaveLength(1);

    hasFocus.mockReturnValue(false);
    notifyChatMessage(useStore, mention, true);
    await settle();
    expect(FakeNotification.instances).toHaveLength(2);
  });

  it("stays quiet while the bell is muted", async () => {
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, notificationVolume: 0 },
    }));
    notifyChatMessage(useStore, mention, false);
    await settle();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("stays quiet while notifications are off", async () => {
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, enableNotifications: false },
    }));
    notifyChatMessage(useStore, mention, false);
    await settle();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("logs a notification the Android plugin fails to post", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Linux; Android 16",
    );
    core.invoke.mockRejectedValueOnce(new Error("no activity") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    notifyChatMessage(useStore, mention, false);

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it("falls back to an in-app note without permission", async () => {
    FakeNotification.permission = "denied";
    notifyChatMessage(useStore, mention, false);
    await settle();
    expect(useStore.getState().globalNotifications).toHaveLength(1);
  });
});

describe("offering notifications in the app", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const saved = new Map<string, string>();

  beforeEach(() => {
    saved.clear();
    vi.mocked(localStorage.getItem).mockImplementation(
      (key) => saved.get(key) ?? null,
    );
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      saved.set(key, value);
    });
  });

  it("asks once on a fresh install and turns them on when allowed", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockImplementationOnce(async () => {
      plugin.isPermissionGranted.mockResolvedValue(true);
      return "granted";
    });
    useStore.setState((state) => ({
      globalSettings: {
        ...state.globalSettings,
        enableNotifications: false,
      },
    }));

    offerNotificationsOnce(useStore);
    await vi.waitFor(() =>
      expect(useStore.getState().globalSettings.enableNotifications).toBe(true),
    );
    offerNotificationsOnce(useStore);
    await settle();

    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
  });

  const permissionChecks = () =>
    core.invoke.mock.calls.filter(
      ([command]) => command === "plugin:notification|is_permission_granted",
    ).length;

  it("turns them on when the user allows a prompt left open from before a reload on iOS", async () => {
    vi.useFakeTimers();
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValueOnce("denied");
    core.invoke
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(true as never);
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, enableNotifications: false },
    }));

    offerNotificationsOnce(useStore);
    await vi.advanceTimersByTimeAsync(1000);

    expect(useStore.getState().globalSettings.enableNotifications).toBe(true);
  });

  it("stops waiting for an iOS prompt that stays open", async () => {
    vi.useFakeTimers();
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValueOnce("denied");
    core.invoke.mockImplementation(async () => null as never);
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, enableNotifications: true },
    }));

    offerNotificationsOnce(useStore);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(permissionChecks()).toBe(60);
    expect(useStore.getState().globalSettings.enableNotifications).toBe(false);
  });

  it("keeps the choice of someone who already has saved settings", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    saved.set("globalSettings", JSON.stringify({ enableNotifications: false }));
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, enableNotifications: false },
    }));

    offerNotificationsOnce(useStore);
    await settle();

    expect(plugin.requestPermission).not.toHaveBeenCalled();
    expect(useStore.getState().globalSettings.enableNotifications).toBe(false);
  });
});
