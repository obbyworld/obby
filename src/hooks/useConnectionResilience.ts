import { useCallback, useEffect, useRef } from "react";
import { ircClient } from "../lib/ircClient";
import { isTauri } from "../lib/platformUtils";

// Only treat a visibility gap as a potential sleep if it lasted longer than this.
// Normal window switching is <1s; sleep is typically minutes.
const SLEEP_THRESHOLD_MS = 30_000;
// A sleeping machine stops our timers, so a tick that arrives far later than
// scheduled means we just woke up, even when the window never lost visibility.
const TICK_MS = 10_000;
const MISSED_TICK_MS = 30_000;

export function useConnectionResilience() {
  const hiddenAtRef = useRef<number | null>(null);

  const triggerWakeReconnect = useCallback(() => {
    for (const server of ircClient.getServers()) {
      ircClient.wakeReconnect(server.id);
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        // Only reconnect if the app was hidden long enough to suggest sleep
        if (hiddenAt !== null && Date.now() - hiddenAt > SLEEP_THRESHOLD_MS) {
          triggerWakeReconnect();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Network reconnect is always worth acting on
    window.addEventListener("online", triggerWakeReconnect);

    let lastTick = Date.now();
    // A hidden tab gets its timers throttled to once a minute, so we only read
    // a late tick as sleep while visible; coming back is the visibility check.
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (
        document.visibilityState === "visible" &&
        now - lastTick > MISSED_TICK_MS
      )
        triggerWakeReconnect();
      lastTick = now;
    }, TICK_MS);

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("tauri://focus", triggerWakeReconnect).then((fn) => {
          unlisten = fn;
        });
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", triggerWakeReconnect);
      window.clearInterval(tick);
      unlisten?.();
    };
  }, [triggerWakeReconnect]);
}
