import type { GlobalSettings } from "../store/types";
import type { WebPushFailure } from "../types";
import ircClient from "./ircClient";
import { backgroundNotificationStrings } from "./notifications";
import { findPushRegistration, pushScope } from "./pushRegistration";
import { b64uDecode, b64uEncode } from "./sasl/webauthn";

const WEB_PUSH_CAPABILITIES = ["draft/webpush", "soju.im/webpush"];
// Chrome can leave subscribe() unsettled for good, so we give up on a step after this long.
const PUSH_STEP_TIMEOUT_MS = 30_000;

export interface PushContext {
  channelTitle: string;
  encryptedBody: string;
  chantypes: string;
  nick: string;
  customMentions: string[];
  ignoreList: string[];
}

export function hasWebPush(serverId: string): boolean {
  return WEB_PUSH_CAPABILITIES.some((cap) =>
    ircClient.hasCapability(serverId, cap),
  );
}

export function pushContextFor(
  serverId: string,
  {
    customMentions,
    ignoreList,
  }: Pick<GlobalSettings, "customMentions" | "ignoreList">,
): PushContext {
  return {
    ...backgroundNotificationStrings(),
    chantypes: ircClient.chantypes(serverId),
    nick: ircClient.getNick(serverId) ?? "",
    customMentions,
    ignoreList,
  };
}

function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function whenActive(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
  if (registration.active) return Promise.resolve(registration.active);
  const pending = registration.installing ?? registration.waiting;
  return new Promise((resolve, reject) => {
    const failed = new DOMException(
      "push worker failed to install",
      "InvalidStateError",
    );
    if (!pending) return reject(failed);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") resolve(pending);
      if (pending.state === "redundant") reject(failed);
    });
  });
}

// The first connection can start before the hosted build registers its service worker, so we wait for it.
async function pushRegistrationFor(
  serverId: string,
): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported() || !__HIDE_SERVER_LIST__) return null;
  await withTimeout("service worker", navigator.serviceWorker.ready);
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: pushScope(serverId),
  });
  await whenActive(registration);
  return registration;
}

function withTimeout<T>(step: string, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new DOMException(
            `${step} did not answer in ${PUSH_STEP_TIMEOUT_MS} ms`,
            "TimeoutError",
          ),
        ),
      PUSH_STEP_TIMEOUT_MS,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function isSameKey(subscription: PushSubscription, vapidKey: string): boolean {
  const existing = subscription.options.applicationServerKey;
  if (!existing) return false;
  const have = new Uint8Array(existing);
  const want = b64uDecode(vapidKey);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}

export function sendPushContext(serverId: string, context: PushContext): void {
  void findPushRegistration(serverId).then((registration) =>
    registration?.active?.postMessage({ type: "obby-push-context", context }),
  );
}

type RegisterResult = "registered" | WebPushFailure;

async function subscribeAndRegister(
  serverId: string,
  vapidKey: string,
  context: PushContext,
  isCurrent: () => boolean,
): Promise<RegisterResult> {
  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await pushRegistrationFor(serverId);
    if (!registration) return "registered";
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !isSameKey(subscription, vapidKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await withTimeout(
      "push subscribe",
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uDecode(vapidKey),
      }),
    );
    const p256dh = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!p256dh || !auth) return "failed";
    if (!isCurrent()) return "failed";
    registration.active?.postMessage({ type: "obby-push-context", context });
    ircClient.sendRaw(
      serverId,
      `WEBPUSH REGISTER ${subscription.endpoint} p256dh=${b64uEncode(p256dh)};auth=${b64uEncode(auth)}`,
    );
    return "registered";
  } catch (error) {
    if (!(error instanceof DOMException || error instanceof TypeError))
      throw error;
    console.warn("[webpush] subscribe/register failed:", error);
    // A hung subscribe blocks its registration, so only that time-out gets a fresh registration.
    if (
      !registration ||
      !(error instanceof DOMException && error.name === "TimeoutError")
    )
      return "failed";
    // A subscribe that never answers keeps blocking its registration, so we drop the registration.
    await registration
      .unregister()
      .catch((unregisterError: unknown) =>
        console.warn(
          "[webpush] could not drop the stuck registration:",
          unregisterError,
        ),
      );
    return "timed-out";
  }
}

/** `isCurrent` reports whether the caller still wants this registration. */
export async function registerWebPush(
  serverId: string,
  vapidKey: string,
  context: PushContext,
  isCurrent: () => boolean,
): Promise<RegisterResult> {
  if (Notification.permission !== "granted") return "failed";
  let result = await subscribeAndRegister(
    serverId,
    vapidKey,
    context,
    isCurrent,
  );
  // A fresh registration subscribes where the stuck one hung, so we try once more.
  if (result === "timed-out" && isCurrent())
    result = await subscribeAndRegister(serverId, vapidKey, context, isCurrent);
  return result;
}

/** Drops this browser's subscription for the server, and tells the server
 *  while we are still connected to it. */
export async function unregisterWebPush(
  serverId: string,
  isConnected: boolean,
): Promise<void> {
  const registration = await findPushRegistration(serverId);
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription && isConnected)
    ircClient.sendRaw(serverId, `WEBPUSH UNREGISTER ${subscription.endpoint}`);
  await registration.unregister();
}
