import type React from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { stopTouchOutsideMap } from "../../lib/leafletMap";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

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
function isInsideScrolledContent(target: Element, sheet: Element | null) {
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

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  children,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    startTime: number;
    offset: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const setOffset = (offset: number, isAnimated: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = isAnimated ? "transform 200ms ease-out" : "none";
    sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    stopTouchOutsideMap(e);
    const target = e.target as Element;
    dragRef.current = isInsideScrolledContent(target, sheetRef.current)
      ? null
      : { startY: e.touches[0].clientY, startTime: e.timeStamp, offset: 0 };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    stopTouchOutsideMap(e);
    const drag = dragRef.current;
    if (!drag) return;
    drag.offset = Math.max(0, e.touches[0].clientY - drag.startY);
    setOffset(drag.offset, false);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    stopTouchOutsideMap(e);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.offset === 0) return;
    if (
      isDismissingSwipe(
        drag.offset,
        e.timeStamp - drag.startTime,
        sheetHeight(),
      )
    )
      onClose();
    else setOffset(0, true);
  };

  const sheetHeight = () => sheetRef.current?.offsetHeight ?? 0;

  // React bubbles portal events through the component tree, so we stop touches
  // here or the long-press and swipe handlers around the opener would fire too.
  return createPortal(
    <div
      className="fixed inset-0 z-[9998]"
      data-no-gesture=""
      onTouchStart={stopTouchOutsideMap}
      onTouchMove={stopTouchOutsideMap}
      onTouchEnd={stopTouchOutsideMap}
    >
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        className="absolute bottom-0 left-0 right-0 surface-sheet"
        style={{ animation: "bottom-sheet-slide-up 200ms ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          dragRef.current = null;
          setOffset(0, true);
        }}
      >
        <span className="sheet-handle mb-2" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
