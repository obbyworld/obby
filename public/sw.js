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

const NAV_CACHE = "obby-hosted-nav-v1";

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
