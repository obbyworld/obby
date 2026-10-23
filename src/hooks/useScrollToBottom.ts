import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export const SCROLL_TOLERANCE = 30;

export function isScrolledToBottom(
  container: HTMLElement,
  tolerance: number = SCROLL_TOLERANCE,
): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    tolerance
  );
}

export interface UseScrollToBottomOptions {
  tolerance?: number;
  channelId?: string | null;
}

export interface UseScrollToBottomReturn {
  isScrolledUp: boolean;
  wasAtBottomRef: MutableRefObject<boolean>;
  scrollToBottom: () => void;
}

export function useScrollToBottom(
  containerRef: RefObject<HTMLElement | null>,
  endElementRef: RefObject<HTMLElement | null>,
  options: UseScrollToBottomOptions = {},
): UseScrollToBottomReturn {
  const { tolerance = SCROLL_TOLERANCE, channelId } = options;
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const wasAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [containerRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is intentionally included to re-initialize scroll detection when channel changes
  useEffect(() => {
    const container = containerRef.current;
    const endElement = endElementRef.current;

    if (!container || !endElement) return;

    // Tracks whether the user is actively wheeling upward.
    // Suppresses scroll/IO callbacks from resetting wasAtBottomRef to true while the
    // user is mid-gesture — prevents the "within-tolerance bounce" where a slow upward
    // wheel fires, then the scroll event re-checks position (still within 30px) and
    // immediately re-enables auto-scroll.
    let wheelUpActive = false;
    let wheelUpCooldown: ReturnType<typeof setTimeout> | null = null;

    const clearWheelUp = () => {
      wheelUpActive = false;
      if (wheelUpCooldown !== null) {
        clearTimeout(wheelUpCooldown);
        wheelUpCooldown = null;
      }
    };

    const checkIfScrolledToBottom = () => {
      // Skip when container is display:none — all dimensions collapse to 0,
      // so isScrolledToBottom returns true and corrupts wasAtBottomRef.
      if (container.clientHeight === 0) return;
      const atBottom = isScrolledToBottom(container, tolerance);
      setIsScrolledUp(!atBottom);
      if (wheelUpActive) {
        // User is still mid-gesture. Only cancel suppression once they've
        // genuinely scrolled past the tolerance zone.
        if (!atBottom) {
          clearWheelUp();
          wasAtBottomRef.current = false;
        }
        // If atBottom while suppressed: keep wasAtBottomRef false so the next
        // message doesn't trigger auto-scroll back down.
      } else {
        wasAtBottomRef.current = atBottom;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0].isIntersecting;
        // When the keep-alive channel wrapper goes display:none, IO fires isIntersecting:false.
        // At that point the container's layout dimensions collapse to 0, so
        // isScrolledToBottom() returns true — discard the callback to avoid corrupting state.
        // This also covers stale callbacks that arrive after the channel becomes visible again.
        if (!isVisible && isScrolledToBottom(container, tolerance)) {
          return;
        }
        setIsScrolledUp(!isVisible);
        if (wheelUpActive) {
          if (!isVisible) {
            clearWheelUp();
            wasAtBottomRef.current = false;
          }
        } else {
          wasAtBottomRef.current = isVisible;
        }
      },
      {
        root: container,
        threshold: 0,
        rootMargin: `${tolerance}px`,
      },
    );

    observer.observe(endElement);

    let rafId1: number;
    let rafId2: number;
    const checkInitial = () => {
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(checkIfScrolledToBottom);
      });
    };
    checkInitial();

    container.addEventListener("scroll", checkIfScrolledToBottom, {
      passive: true,
    });

    container.addEventListener("touchend", checkIfScrolledToBottom, {
      passive: true,
    });

    // On macOS Tauri (WKWebView), scroll events are batched and delivered with a
    // delay during trackpad momentum. This creates a window where wasAtBottomRef
    // is stale (still true) when a new message arrives, causing auto-scroll to
    // fire and pull content back down while the user is still swiping up.
    // The wheel event fires synchronously with the physical gesture, before any
    // scroll events, so we use it to immediately clear wasAtBottomRef and arm
    // the suppression window.
    const handleWheel = (e: WheelEvent) => {
      // A short buffer cannot move, so no scroll event would ever clear the flag.
      const canScroll =
        container.scrollHeight - container.clientHeight > tolerance;
      if (e.deltaY < 0 && canScroll) {
        wheelUpActive = true;
        wasAtBottomRef.current = false;
        setIsScrolledUp(true);
        if (wheelUpCooldown !== null) clearTimeout(wheelUpCooldown);
        // 400ms covers trackpad momentum; after that, normal scroll detection resumes.
        wheelUpCooldown = setTimeout(() => {
          wheelUpActive = false;
          wheelUpCooldown = null;
          checkIfScrolledToBottom();
        }, 400);
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", checkIfScrolledToBottom);
      container.removeEventListener("touchend", checkIfScrolledToBottom);
      container.removeEventListener("wheel", handleWheel);
      if (wheelUpCooldown !== null) clearTimeout(wheelUpCooldown);
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
    };
  }, [containerRef, endElementRef, tolerance, channelId]);

  // Re-stick to bottom when container resizes (sidebar toggle, window resize, input bar growing).
  // Uses prevClientHeight instead of wasAtBottomRef to avoid the race where IntersectionObserver
  // clears wasAtBottomRef before ResizeObserver fires (observed in WKWebView).
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is intentionally included to re-initialize when channel changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let prevClientHeight = container.clientHeight;

    const observer = new ResizeObserver(() => {
      if (container.clientHeight === 0) return;
      // Effect may re-initialize while container is display:none (prevClientHeight=0).
      // Re-seed with current dimensions and skip — no reliable "was at bottom" data.
      if (prevClientHeight === 0) {
        prevClientHeight = container.clientHeight;
        return;
      }
      const wasAtBottom =
        container.scrollTop + prevClientHeight >=
        container.scrollHeight - tolerance;
      prevClientHeight = container.clientHeight;
      if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, channelId, tolerance]);

  return { isScrolledUp, wasAtBottomRef, scrollToBottom };
}
