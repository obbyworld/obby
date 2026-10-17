import { useCallback, useEffect, useRef, useState } from "react";

interface SwipeNavigationConfig {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  threshold?: number;
  rubberBandStrength?: number;
}

interface SwipeNavigationReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  offset: number;
  isTransitioning: boolean;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
}

interface TouchState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
  isHorizontal: boolean | null;
  target: HTMLElement | null;
  ignored: boolean;
}

export function useSwipeNavigation({
  currentPage,
  totalPages,
  onPageChange,
  threshold = 50,
  rubberBandStrength = 0.3,
}: SwipeNavigationConfig): SwipeNavigationReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const offsetRef = useRef(0);
  const touchState = useRef<TouchState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isDragging: false,
    isHorizontal: null,
    target: null,
    ignored: false,
  });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (document.documentElement.dataset.keyboardVisible) {
      return;
    }

    const touch = e.touches[0];
    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isDragging: false,
      isHorizontal: null,
      target: e.target as HTMLElement,
      // A map or a carousel handles its own dragging, and a modal reaches us
      // through the React tree even when it renders into its own portal.
      ignored: !!(e.target as Element).closest?.("[data-no-gesture]"),
    };
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isTransitioning || touchState.current.ignored) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchState.current.startX;
      const deltaY = touch.clientY - touchState.current.startY;

      if (touchState.current.isHorizontal === null) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX > 10 || absY > 10) {
          touchState.current.isHorizontal = absX > absY;
        }
      }

      if (touchState.current.isHorizontal === false) {
        return;
      }

      if (touchState.current.isHorizontal === true) {
        touchState.current.isDragging = true;

        let newOffset = deltaX;
        const containerWidth =
          containerRef.current?.offsetWidth || window.innerWidth;

        // At boundary pages (first/last), apply rubber banding to prevent going off-screen
        if (currentPage === 0 && deltaX > 0) {
          newOffset = deltaX * rubberBandStrength;
        } else if (currentPage === totalPages - 1 && deltaX < 0) {
          newOffset = deltaX * rubberBandStrength;
        } else {
          // For middle pages, apply progressive rubber banding
          // - Light rubber banding starts at 60% of screen width
          // - Strong rubber banding starts at 85% of screen width
          // - Very strong rubber banding beyond 85% to prevent any overshoot
          const lightThreshold = containerWidth * 0.6;
          const strongThreshold = containerWidth * 0.85;
          const absDeltaX = Math.abs(deltaX);

          if (absDeltaX > strongThreshold) {
            // Beyond 85% screen width: extremely strong rubber banding (0.05)
            const excessDistance = absDeltaX - strongThreshold;
            const sign = deltaX > 0 ? 1 : -1;
            newOffset = sign * (strongThreshold + excessDistance * 0.05);
          } else if (absDeltaX > lightThreshold) {
            // Between 60-85%: moderate rubber banding (0.3)
            const excessDistance = absDeltaX - lightThreshold;
            const sign = deltaX > 0 ? 1 : -1;
            newOffset =
              sign * (lightThreshold + excessDistance * rubberBandStrength);
          }
          // else: under 60%, no rubber banding (newOffset = deltaX)
        }

        offsetRef.current = newOffset;
        setOffset(newOffset);
      }
    },
    [currentPage, totalPages, rubberBandStrength, isTransitioning],
  );

  const handleTouchEnd = useCallback(() => {
    if (!touchState.current.isDragging) {
      return;
    }

    const deltaX = offsetRef.current;
    let newPage = currentPage;

    if (Math.abs(deltaX) > threshold) {
      if (deltaX > 0 && currentPage > 0) {
        newPage = currentPage - 1;
      } else if (deltaX < 0 && currentPage < totalPages - 1) {
        newPage = currentPage + 1;
      }
    }

    setIsTransitioning(true);
    setOffset(0);
    offsetRef.current = 0;
    touchState.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isDragging: false,
      isHorizontal: null,
      target: null,
      ignored: false,
    };

    if (newPage !== currentPage) {
      onPageChange(newPage);
    }

    setTimeout(() => {
      setIsTransitioning(false);
    }, 300);
  }, [currentPage, totalPages, threshold, onPageChange]);

  // React synthetic touchmove is passive and can't call preventDefault.
  // A native non-passive listener blocks inner scroll while a horizontal page swipe is active.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onNativeTouchMove(e: TouchEvent) {
      if (touchState.current.isHorizontal === true) {
        e.preventDefault();
      }
    }
    container.addEventListener("touchmove", onNativeTouchMove, {
      passive: false,
    });
    return () => container.removeEventListener("touchmove", onNativeTouchMove);
  }, []);

  return {
    containerRef,
    offset,
    isTransitioning,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
