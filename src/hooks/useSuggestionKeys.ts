import { useEffect } from "react";

interface UseSuggestionKeysOptions {
  isActive: boolean;
  count: number;
  selectedIndex: number;
  onMove: (index: number) => void;
  // Returning false leaves the key to whatever has focus.
  onAccept: (index: number) => boolean;
  onClose: () => void;
  acceptKeys?: readonly string[];
  closeKeys?: readonly string[];
}

const ACCEPT_KEYS = ["Enter"];
const CLOSE_KEYS = ["Escape"];

// We listen in the capture phase so the chat input never sees the keys a
// suggestion list consumes.
export function useSuggestionKeys({
  isActive,
  count,
  selectedIndex,
  onMove,
  onAccept,
  onClose,
  acceptKeys = ACCEPT_KEYS,
  closeKeys = CLOSE_KEYS,
}: UseSuggestionKeysOptions): void {
  useEffect(() => {
    if (!isActive || count === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      let next: number | null = null;
      if (e.key === "ArrowDown") next = (selectedIndex + 1) % count;
      else if (e.key === "ArrowUp")
        next = selectedIndex === 0 ? count - 1 : selectedIndex - 1;
      else if (acceptKeys.includes(e.key)) {
        if (onAccept(selectedIndex) === false) return;
      } else if (closeKeys.includes(e.key)) onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
      if (next !== null) onMove(next);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    isActive,
    count,
    selectedIndex,
    onMove,
    onAccept,
    onClose,
    acceptKeys,
    closeKeys,
  ]);
}
