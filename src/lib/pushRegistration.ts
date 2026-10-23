// Each server gets its own service worker registration, since a browser
// subscription carries one VAPID key and a push names no server: the worker
// knows its server from its scope.
export function pushScope(serverId: string): string {
  return new URL(`/push/${encodeURIComponent(serverId)}/`, location.origin)
    .href;
}

/** Drops the registrations of servers the user removed, which also ends
 *  their subscriptions, so those servers prune them on their next push. */
export async function dropRemovedServersPush(
  serverIds: string[],
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const kept = new Set(serverIds.map(pushScope));
  const pushRoot = new URL("/push/", location.origin).href;
  for (const registration of await navigator.serviceWorker.getRegistrations())
    if (
      registration.scope.startsWith(pushRoot) &&
      !kept.has(registration.scope)
    )
      await registration.unregister();
}

// An earlier build subscribed on the app's own worker, whose pushes now show nothing.
export async function dropRootPushSubscription(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const root = new URL("/", location.origin).href;
  const registration = await navigator.serviceWorker.getRegistration(root);
  if (registration?.scope !== root) return;
  await (await registration.pushManager?.getSubscription())?.unsubscribe();
}

export async function findPushRegistration(
  serverId: string,
): Promise<ServiceWorkerRegistration | undefined> {
  if (!("serviceWorker" in navigator)) return undefined;
  const scope = pushScope(serverId);
  const registration = await navigator.serviceWorker.getRegistration(scope);
  return registration?.scope === scope ? registration : undefined;
}

// The page tells the worker which messages it already showed, so a push for
// the same message stays quiet.
export function markShownByPage(serverId: string, msgid?: string): void {
  if (!msgid) return;
  void findPushRegistration(serverId).then((registration) =>
    registration?.active?.postMessage({ type: "obby-shown", msgid }),
  );
}

/** Shows a notification through the server's push worker, so a push for the
 *  same tag replaces it. Resolves to false while the server has no active worker. */
export async function showOnPushWorker(
  serverId: string,
  title: string,
  options: NotificationOptions,
  msgid?: string,
): Promise<boolean> {
  const registration = await findPushRegistration(serverId);
  if (!registration?.active) return false;
  if (msgid) registration.active.postMessage({ type: "obby-shown", msgid });
  await registration.showNotification(title, options);
  return true;
}

export function closePushNotifications(serverId: string, tag: string): void {
  void findPushRegistration(serverId)
    .then((registration) => registration?.getNotifications({ tag }))
    .then((shown) => {
      for (const notification of shown ?? []) notification.close();
    });
}
