import { useEffect, useRef } from "react";
import { isTauri } from "../lib/platformUtils";

// In the browser the phone's back gesture walks history, so we add an entry
// while the overlay is open and close the overlay when that entry is popped.
// The native apps route back through window.androidBackCallback instead.
export function useCloseOnHistoryBack(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || isTauri()) return;
    let poppedByBack = false;
    window.history.pushState({ obbyOverlay: true }, "");
    const handlePop = () => {
      poppedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePop);
    return () => {
      window.removeEventListener("popstate", handlePop);
      if (!poppedByBack && window.history.state?.obbyOverlay)
        window.history.back();
    };
  }, [isOpen]);
}
