// Minimal service worker for the hosted-PWA build mode. Its only jobs:
//   1. Satisfy the browser's PWA install criteria (must have a registered
//      SW with a fetch handler).
//   2. Cache the navigation response so the chrome reloads without the
//      network when the user opens the installed PWA offline.
//
// Hashed asset bundles get their own cache identity automatically since
// the URL changes on every deploy; we never serve a stale asset, just
// fall back to whatever's cached when fetch fails. The HTML cache is
// trimmed to the single latest navigation entry to avoid unbounded
// growth.

const NAV_CACHE = "obsidianirc-hosted-nav-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    // Network-first: always try the live network so a fresh deploy is
    // picked up immediately. Cache the response for the offline path.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(NAV_CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() =>
          caches
            .open(NAV_CACHE)
            .then((c) => c.match("/").then((r) => r || Response.error())),
        ),
    );
    return;
  }
});

// --- soju.im/webpush ---------------------------------------------------
// The server (via the hosted-backend) sends exactly one IRC message as
// the encrypted push payload: no trailing CRLF, tags dropped except
// msgid. We parse the minimum needed to render a notification.

function parseIrcLine(line) {
  let rest = line;
  let msgid = null;
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    const tags = rest.slice(1, sp);
    for (const t of tags.split(";")) {
      const eq = t.indexOf("=");
      if (eq !== -1 && t.slice(0, eq) === "msgid") msgid = t.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }
  if (!rest.startsWith(":")) return null;
  const sp = rest.indexOf(" ");
  if (sp === -1) return null;
  const nick = rest.slice(1, sp).split("!")[0];
  rest = rest.slice(sp + 1);
  const trailingIdx = rest.indexOf(" :");
  let head = rest;
  let text = "";
  if (trailingIdx !== -1) {
    head = rest.slice(0, trailingIdx);
    text = rest.slice(trailingIdx + 2);
  }
  const parts = head.split(" ");
  return { msgid, nick, command: parts[0], target: parts[1] || "", text };
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let raw;
  try {
    raw = event.data.text();
  } catch {
    return;
  }
  event.waitUntil(
    (async () => {
      const parsed = parseIrcLine(raw);
      if (!parsed || !parsed.nick) return;

      // If a client window is focused, the in-app notifier already
      // surfaces this message -- don't double-notify.
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (wins.some((c) => c.focused)) return;

      await self.registration.showNotification(parsed.nick, {
        body: parsed.text || "",
        icon: "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        // Collapse repeated DMs from the same person into one slot
        // rather than stacking endlessly.
        tag: `pm-${parsed.nick}`,
        renotify: true,
        data: { nick: parsed.nick, target: parsed.target },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const c of wins) {
          if ("focus" in c) return c.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/");
      }),
  );
});
