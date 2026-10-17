import { afterEach, describe, expect, it, vi } from "vitest";
import { dropRootPushSubscription } from "../../src/lib/pushRegistration";

const withRegistration = (registration: unknown) =>
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => registration },
  });

describe("dropping the push subscription on the app's own worker", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("unsubscribes the root registration", async () => {
    const unsubscribe = vi.fn(async () => true);
    withRegistration({
      scope: new URL("/", location.origin).href,
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
    });

    await dropRootPushSubscription();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("leaves a server's registration alone", async () => {
    const unsubscribe = vi.fn(async () => true);
    withRegistration({
      scope: new URL("/push/srv-1/", location.origin).href,
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
    });

    await dropRootPushSubscription();

    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
