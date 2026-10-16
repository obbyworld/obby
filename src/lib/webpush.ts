import type { GlobalSettings } from "../store/types";
import ircClient from "./ircClient";
import { backgroundNotificationStrings } from "./notifications";
import { findPushRegistration, pushScope } from "./pushRegistration";
import { b64uDecode, b64uEncode } from "./sasl/webauthn";

const WEB_PUSH_CAPABILITIES = ["draft/webpush", "soju.im/webpush"];

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

// Only builds that register the app's own service worker offer push.
async function pushRegistrationFor(
  serverId: string,
): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported() || !(await navigator.serviceWorker.getRegistration()))
    return null;
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: pushScope(serverId),
  });
  await whenActive(registration);
  return registration;
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

/** Returns false when the browser could not subscribe, so the caller retries. */
export async function registerWebPush(
  serverId: string,
  vapidKey: string,
  context: PushContext,
): Promise<boolean> {
  if (Notification.permission !== "granted") return false;
  try {
    const registration = await pushRegistrationFor(serverId);
    if (!registration) return true;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !isSameKey(subscription, vapidKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uDecode(vapidKey),
    });
    const p256dh = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!p256dh || !auth) return false;
    registration.active?.postMessage({ type: "obby-push-context", context });
    ircClient.sendRaw(
      serverId,
      `WEBPUSH REGISTER ${subscription.endpoint} p256dh=${b64uEncode(p256dh)};auth=${b64uEncode(auth)}`,
    );
    return true;
  } catch (error) {
    if (!(error instanceof DOMException || error instanceof TypeError))
      throw error;
    console.warn("[webpush] subscribe/register failed:", error);
    return false;
  }
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
