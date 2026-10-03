import { useCallback, useRef } from "react";
import { haptic } from "../lib/haptic";

export const LONG_PRESS_DELAY_MS = 400;
export const TOUCH_MOVE_THRESHOLD_PX = 10;

interface UseLongPressOptions {
  delay?: number;
  moveThreshold?: number;
  onLongPress: () => void;
}

export function useLongPress({
  delay = LONG_PRESS_DELAY_MS,
  moveThreshold = TOUCH_MOVE_THRESHOLD_PX,
  onLongPress,
}: UseLongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
    // Restore text selection
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      firedRef.current = false;
      const touch = e.touches[0];
      startPos.current = { x: touch.clientX, y: touch.clientY };
      // Suppress global text selection during hold to prevent iOS from
      // selecting text in adjacent elements
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        haptic("light");
        onLongPress();
        timerRef.current = null;
      }, delay);
    },
    [delay, onLongPress],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startPos.current.x;
      const dy = touch.clientY - startPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
        clear();
      }
    },
    [moveThreshold, clear],
  );

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  const onTouchCancel = useCallback(() => {
    clear();
  }, [clear]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    firedRef,
  };
}
