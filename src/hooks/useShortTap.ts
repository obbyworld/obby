import { useRef } from "react";
import { LONG_PRESS_DELAY_MS, TOUCH_MOVE_THRESHOLD_PX } from "./useLongPress";

const INTERACTIVE = "a, button, input, select, textarea, video, audio";

// We fire on a still touch that ends just before the long-press delay, so a tap
// and a hold on the same element each get their own action.
export function useShortTap(onTap: () => void) {
  const startRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startRef.current = { t: Date.now(), x: touch.clientX, y: touch.clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;
    const touch = e.touches[0];
    if (
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >
      TOUCH_MOVE_THRESHOLD_PX
    )
      startRef.current = null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || Date.now() - start.t >= LONG_PRESS_DELAY_MS - 20) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    // We cancel the synthetic click so the tap is handled exactly once.
    e.preventDefault();
    onTap();
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}
