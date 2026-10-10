import type React from "react";
import { useEffect } from "react";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation";
import type { AppPage } from "../../store/types";
import PageHost from "../pages/PageHost";
import { goBackInPage } from "../ui/page/PageShell";

// On a phone a page sits above the swipeable columns like a pushed screen, so
// swiping right steps back through it and never reaches the member list.
export const PageLayer: React.FC<{ page: AppPage }> = ({ page }) => {
  const {
    containerRef,
    offset,
    isTransitioning,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useSwipeNavigation({
    currentPage: 1,
    totalPages: 2,
    onPageChange: () => goBackInPage(),
  });

  // PageShell keeps focus off pages on touch, so we land screen readers on
  // the heading here; a heading takes focus without raising the keyboard.
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>("h1")
      ?.focus({ preventScroll: true });
  }, [containerRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20 bg-discord-dark-200 shadow-2xl"
      onTouchStart={(e) => {
        e.stopPropagation();
        handleTouchStart(e);
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
        handleTouchMove(e);
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        handleTouchEnd(e);
      }}
      style={{
        touchAction: "pan-y",
        transform: `translateX(${Math.max(0, offset)}px)`,
        transition: isTransitioning
          ? "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
          : "none",
      }}
    >
      <PageHost page={page} />
    </div>
  );
};

export default PageLayer;
