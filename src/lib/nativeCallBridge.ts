// The Android shell (MainActivity.kt) exposes `ObbyNative` so a live call can
// shrink into the OS picture-in-picture window, and dispatches the event below
// whenever that window opens or closes. The iOS shell (the ios-keyboard plugin's
// AppLifecycle.swift) calls `ObbyApp` when the app comes back to the foreground.

declare global {
  interface Window {
    ObbyNative?: { setInCall: (isActive: boolean) => void };
    ObbyApp?: { didBecomeActive: () => void };
  }
}

const NATIVE_PIP_EVENT = "obby-native-pip";

export function setNativeInCall(isActive: boolean): void {
  globalThis.window?.ObbyNative?.setInCall(isActive);
}

export function subscribeNativePip(
  onChange: (isNativePip: boolean) => void,
): () => void {
  const listener = (e: Event) =>
    onChange((e as CustomEvent<boolean>).detail === true);
  window.addEventListener(NATIVE_PIP_EVENT, listener);
  return () => window.removeEventListener(NATIVE_PIP_EVENT, listener);
}

/** Lets the iOS shell restart call videos that iOS paused while the app was
 *  away. */
export function exposeAppLifecycleHooks(): void {
  if (typeof window === "undefined") return;
  window.ObbyApp = {
    didBecomeActive: () => {
      for (const video of document.querySelectorAll<HTMLVideoElement>(
        "video[data-call-video]",
      )) {
        if (video.paused) video.play().catch(() => {});
      }
    },
  };
}
