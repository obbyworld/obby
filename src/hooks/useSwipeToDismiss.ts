import { useCallback, useRef } from "react";

/** A swipe closes the sheet when it drags a third of the sheet down, or flicks. */
export function isDismissingSwipe(
  offset: number,
  durationMs: number,
  sheetHeight: number,
): boolean {
  const isFlick = durationMs > 0 && offset / durationMs > 0.5 && offset > 30;
  return isFlick || offset > Math.min(120, sheetHeight / 3);
}

// A swipe inside content that is scrolled down scrolls it back up instead.
function isInsideScrolledContent(target: Element, sheet: Element) {
  for (
    let el: Element | null = target;
    el && el !== sheet;
    el = el.parentElement
  ) {
    if (el.closest(".leaflet-container")) return true;
    if (el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Returns a ref for a bottom sheet that follows a downward finger drag and
 * closes on a far drag or a flick. We attach native non-passive listeners
 * because WebKit starts its own pan unless touchmove is cancelled.
 */
export function useSwipeToDismiss(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((sheet: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!sheet) return;

    let drag: {
      target: Element;
      startY: number;
      startTime: number;
      offset: number;
    } | null = null;

    const setOffset = (offset: number, isAnimated: boolean) => {
      sheet.style.transition = isAnimated ? "transform 200ms ease-out" : "none";
      sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
    };

    const onStart = (e: TouchEvent) => {
      const target = e.target as Element;
      drag = isInsideScrolledContent(target, sheet)
        ? null
        : {
            target,
            startY: e.touches[0].clientY,
            startTime: e.timeStamp,
            offset: 0,
          };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag) return;
      if (isInsideScrolledContent(drag.target, sheet)) {
        drag = null;
        setOffset(0, true);
        return;
      }
      drag.offset = Math.max(0, e.touches[0].clientY - drag.startY);
      if (drag.offset > 0 && e.cancelable) e.preventDefault();
      setOffset(drag.offset, false);
    };

    const onEnd = (e: TouchEvent) => {
      const finished = drag;
      drag = null;
      if (!finished || finished.offset === 0) return;
      const duration = e.timeStamp - finished.startTime;
      if (isDismissingSwipe(finished.offset, duration, sheet.offsetHeight))
        onCloseRef.current();
      else setOffset(0, true);
    };

    const onCancel = () => {
      drag = null;
      setOffset(0, true);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onCancel);
    detachRef.current = () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onCancel);
    };
  }, []);
}
