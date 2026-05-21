// Register the PWA service worker. Every build ships it now — it powers
// offline navigation caching AND Web Push (the `push` handler in
// public/sw.js). Push only actually arms when the user enables
// notifications and the platform supports the Push API; the registration
// itself is harmless on platforms that don't (it just caches).
//
// Registration is deferred to the "load" event so the SW download doesn't
// race the initial bundle parse.
export function registerAppServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[PWA] service worker registration failed:", err);
    });
  });
}
