import { useEffect, useRef } from "react";
import { isMobileDevice, isTauri, isTauriAndroid } from "../lib/platformUtils";
import useStore from "../store";

export const EXIT_HINT_COMMAND = "EXIT_HINT";
export const EXIT_WINDOW_MS = 2000;

function showExitHint() {
  useStore.getState().addGlobalNotification({
    type: "note",
    command: EXIT_HINT_COMMAND,
    code: "",
    message: "",
    serverId: "",
  });
}

// Back closes whatever is open, and once nothing is left it asks for a second
// press before it leaves the app. `onBack` returns true when nothing is left.
export function useBackButton(onBack: () => boolean) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isTauriAndroid()) return;
    let hintShownAt = 0;
    window.androidBackCallback = () => {
      if (!onBackRef.current()) return false;
      if (Date.now() - hintShownAt < EXIT_WINDOW_MS) return true;
      hintShownAt = Date.now();
      showExitHint();
      return false;
    };
    return () => {
      window.androidBackCallback = undefined;
    };
  }, []);

  // A phone browser's back gesture walks history, so we keep one entry on top
  // and turn each pop into a back press. We leave it off while the exit hint
  // shows, so the second press leaves the app.
  useEffect(() => {
    if (isTauri() || !isMobileDevice()) return;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const pushGuard = () =>
      window.history.pushState({ obbyBackGuard: true }, "");
    if (!window.history.state?.obbyBackGuard) pushGuard();
    const handlePop = () => {
      if (!onBackRef.current()) return pushGuard();
      showExitHint();
      restoreTimer = setTimeout(pushGuard, EXIT_WINDOW_MS);
    };
    window.addEventListener("popstate", handlePop);
    return () => {
      window.removeEventListener("popstate", handlePop);
      clearTimeout(restoreTimer);
    };
  }, []);
}
