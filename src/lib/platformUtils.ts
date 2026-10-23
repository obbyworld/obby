declare global {
  interface Window {
    __TAURI__?: unknown;
    androidBackCallback?: () => boolean;
  }
}

export const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

export const isLinux =
  typeof navigator !== "undefined" &&
  /linux/i.test(navigator.userAgent) &&
  !/android/i.test(navigator.userAgent);

export const isTauri = (): boolean => {
  return typeof window !== "undefined" && window.__TAURI__ !== undefined;
};

/** True only on Tauri mobile builds (iOS, Android). False on browser and desktop. */
export const isTauriMobile = (): boolean =>
  isTauri() && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/** True only on Tauri iOS builds. False on Android, desktop, and browser. */
export const isTauriIOS = (): boolean =>
  isTauri() && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** True only on Tauri Android builds. False on iOS, desktop, and browser. */
export const isTauriAndroid = (): boolean =>
  isTauri() && /android/i.test(navigator.userAgent);

/** True only on Tauri desktop builds (macOS, Windows, Linux). False on browser, iOS, Android. */
export const isTauriDesktop = (): boolean => {
  if (!isTauri()) return false;
  // platform() is async in Tauri v2; use navigator.userAgent as a reliable synchronous proxy.
  // Mobile Tauri targets inject Android/iOS patterns; desktop targets do not.
  return !/android|iphone|ipad|ipod/i.test(navigator.userAgent);
};

/** True when the user is typing on a soft keyboard (iOS/iPadOS/Android, native or browser).
 *  Not `(pointer: coarse)` — that's true on Windows touchscreens with physical keyboards.
 *  See https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints */
export const isMobileDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  if (isTauriMobile()) return true;
  if (isTauriDesktop()) return false;
  const ua = navigator.userAgent;
  if (/android|iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh; Macs return maxTouchPoints 0–1, iPads ≥5.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
};
