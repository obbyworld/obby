import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const SLIDE_MS = 220;
const SLIDE = `transform ${SLIDE_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
const DIRECTION_SLOP = 10;
const FLING_PX_PER_MS = 0.5;

interface Drag {
  startX: number;
  startY: number;
  startTime: number;
  isHorizontal: boolean | null;
  isIgnored: boolean;
}

// One level of a phone navigation stack: dragging it right uncovers `under`,
// the level we return to, and we call onBack only once it has slid off, so
// the screen underneath is already the one the reader lands on.
export const SwipeBackScreen: React.FC<{
  under?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}> = ({ under, onBack, children }) => {
  const topRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [offset, setOffset] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // React touch listeners are passive, so we stop the page from scrolling
  // vertically under a horizontal drag with a native one.
  useEffect(() => {
    const top = topRef.current;
    if (!top) return;
    const blockScroll = (e: TouchEvent) => {
      if (dragRef.current?.isHorizontal) e.preventDefault();
    };
    top.addEventListener("touchmove", blockScroll, { passive: false });
    return () => top.removeEventListener("touchmove", blockScroll);
  }, []);

  const width = () => topRef.current?.offsetWidth || window.innerWidth;

  const slideTo = (target: number, then?: () => void) => {
    setIsSliding(true);
    setOffset(target);
    window.setTimeout(() => {
      then?.();
      setIsSliding(false);
      setOffset(0);
    }, SLIDE_MS);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (isSliding || document.documentElement.dataset.keyboardVisible) return;
    const touch = e.touches[0];
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: e.timeStamp,
      isHorizontal: null,
      isIgnored: !!(e.target as Element).closest?.("[data-no-gesture]"),
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.isIgnored) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    if (drag.isHorizontal === null) {
      if (Math.abs(dx) < DIRECTION_SLOP && Math.abs(dy) < DIRECTION_SLOP)
        return;
      drag.isHorizontal = Math.abs(dx) > Math.abs(dy) && dx > 0;
    }
    if (drag.isHorizontal) setOffset(Math.max(0, dx));
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.isHorizontal) return;
    const velocity = offset / Math.max(1, e.timeStamp - drag.startTime);
    if (offset > width() * 0.3 || velocity > FLING_PX_PER_MS)
      slideTo(width(), () => onBackRef.current());
    else slideTo(0);
  };

  const isRevealing = offset > 0 || isSliding;
  const progress = Math.min(1, offset / width());

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {isRevealing && under && (
        <div
          aria-hidden
          inert
          className="absolute inset-0"
          style={{
            transform: `translateX(${(progress - 1) * 30}%)`,
            transition: isSliding ? SLIDE : "none",
          }}
        >
          {under}
        </div>
      )}
      <div
        ref={topRef}
        className="absolute inset-0 flex flex-col bg-discord-dark-200"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{
          touchAction: "pan-y",
          transform: `translateX(${offset}px)`,
          transition: isSliding ? SLIDE : "none",
          boxShadow: isRevealing ? "-8px 0 24px rgba(0,0,0,0.35)" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeBackScreen;
