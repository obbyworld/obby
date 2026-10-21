import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendRaw = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/ircClient", () => ({ default: { sendRaw } }));

import { registerWebPush } from "../../src/lib/webpush";

const KEY = "BAEC";
const CONTEXT = {
  channelTitle: "",
  encryptedBody: "",
  chantypes: "#",
  nick: "me",
  customMentions: [],
  ignoreList: [],
};

function fakeSubscription(endpoint: string, key: number[]) {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(key).buffer },
    getKey: () => new Uint8Array([1]).buffer,
    unsubscribe: vi.fn(async () => true),
  };
}

function withPushRegistrations(...pushManagers: object[]) {
  const registrations = pushManagers.map((pushManager) => ({
    active: { postMessage: vi.fn() },
    pushManager,
    unregister: vi.fn(async () => true),
  }));
  let registered = 0;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      register: async () => registrations[registered++],
    },
  });
  return registrations;
}

const hangingPushManager = () => ({
  getSubscription: async () => null,
  subscribe: () => new Promise(() => {}),
});

const registeredLines = () =>
  sendRaw.mock.calls.map(([, line]) => line.split(" ").slice(0, 3).join(" "));

describe("registering this browser for web push", () => {
  beforeEach(() => {
    vi.stubGlobal("__HIDE_SERVER_LIST__", true);
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sendRaw.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("drops a stuck registration and subscribes on a fresh one", async () => {
    vi.useFakeTimers();
    const [stuck] = withPushRegistrations(hangingPushManager(), {
      getSubscription: async () => null,
      subscribe: async () =>
        fakeSubscription("https://push.example/fresh", [4]),
    });

    const result = registerWebPush("srv", KEY, CONTEXT, () => true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await result).toBe("registered");
    expect(stuck.unregister).toHaveBeenCalled();
    expect(registeredLines()).toEqual([
      "WEBPUSH REGISTER https://push.example/fresh",
    ]);
  });

  it("gives up when the fresh registration hangs too", async () => {
    vi.useFakeTimers();
    const registrations = withPushRegistrations(
      hangingPushManager(),
      hangingPushManager(),
    );

    const result = registerWebPush("srv", KEY, CONTEXT, () => true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await result).toBe("timed-out");
    for (const registration of registrations)
      expect(registration.unregister).toHaveBeenCalled();
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it("reports a plain failure when the app's worker never gets ready", async () => {
    vi.useFakeTimers();
    const [registration] = withPushRegistrations(hangingPushManager());
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: new Promise(() => {}),
        register: async () => registration,
      },
    });

    const result = registerWebPush("srv", KEY, CONTEXT, () => true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await result).toBe("failed");
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with an old key", async () => {
    const old = fakeSubscription("https://push.example/old", [9]);
    withPushRegistrations({
      getSubscription: async () => old,
      subscribe: async () =>
        fakeSubscription("https://push.example/new", [4, 1, 2]),
    });

    expect(await registerWebPush("srv", KEY, CONTEXT, () => true)).toBe(
      "registered",
    );

    expect(old.unsubscribe).toHaveBeenCalled();
    expect(registeredLines()).toEqual([
      "WEBPUSH REGISTER https://push.example/new",
    ]);
  });

  it("keeps the subscription from the server once the caller moved on", async () => {
    withPushRegistrations({
      getSubscription: async () => null,
      subscribe: async () => fakeSubscription("https://push.example/late", [4]),
    });

    expect(await registerWebPush("srv", KEY, CONTEXT, () => false)).toBe(
      "failed",
    );

    expect(sendRaw).not.toHaveBeenCalled();
  });
});
