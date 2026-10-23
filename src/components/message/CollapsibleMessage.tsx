import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useLingui } from "@lingui/react/macro";
import type * as React from "react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isScrolledToBottom } from "../../hooks/useScrollToBottom";
import { isTauriMobile } from "../../lib/platformUtils";

export const COLLAPSIBLE_MAX_LINES = 8;

export interface CollapsibleMessageHandle {
  toggle: () => void;
}

interface CollapsibleMessageProps {
  content: React.ReactNode;
  maxLines?: number;
  onNeedsCollapsing?: (needs: boolean) => void;
}

export const CollapsibleMessage = forwardRef<
  CollapsibleMessageHandle,
  CollapsibleMessageProps
>(({ content, maxLines = COLLAPSIBLE_MAX_LINES, onNeedsCollapsing }, ref) => {
  const { t } = useLingui();
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsCollapsing, setNeedsCollapsing] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = useState<string>("none");
  const contentRef = useRef<HTMLDivElement>(null);
  // Inner wrapper whose box size changes freely — the outer contentRef is
  // max-height-clamped, so ResizeObserver on it would never fire for growing content
  const measuredContentRef = useRef<HTMLDivElement>(null);
  // Stays false through the initial measurement render so the first collapse is instant.
  // Flipped to true via RAF after that render commits; user expand/collapse animates after.
  const allowTransitionRef = useRef(false);
  // Touch tracking for tap-to-toggle on Tauri mobile (iOS/Android only).
  // Distinguishes short taps from long-press (haptic) and scroll gestures.
  const touchStartRef = useRef<{ t: number; x: number; y: number } | null>(
    null,
  );
  const isMobile = isTauriMobile();

  useLayoutEffect(() => {
    if (!contentRef.current || !measuredContentRef.current) return;

    const element = contentRef.current;
    const measuredContent = measuredContentRef.current;

    // Track the RAF ID so it can be cancelled in cleanup or before a new one fires.
    // Initialized to 0 so cancelAnimationFrame is always safe to call first.
    let rafId = 0;

    const measure = () => {
      // Skip when display:none collapses all dimensions — would corrupt state.
      // Both must be 0: jsdom always has clientHeight=0, so the dual condition
      // ensures we only bail in genuine display:none (scrollHeight also collapses).
      if (element.clientHeight === 0 && measuredContent.scrollHeight === 0) {
        allowTransitionRef.current = false;
        return;
      }
      const computedStyle = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 16;
      const maxHeight = lineHeight * maxLines;
      // Use the unclamped inner wrapper's scrollHeight for accurate measurement
      const fullHeight = measuredContent.scrollHeight;
      setContentHeight(fullHeight);
      setCollapsedMaxHeight(`${lineHeight * maxLines}px`);
      const needs = fullHeight > maxHeight;
      setNeedsCollapsing(needs);
      onNeedsCollapsing?.(needs);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        allowTransitionRef.current = true;
      });
    };

    measure();

    // Re-measure when the inner content's rendered size changes (images loading,
    // dynamic embeds, etc.). Observing the inner element avoids the false-no-op
    // from the clamped outer container staying the same size.
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(measuredContent);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [maxLines, onNeedsCollapsing]);

  const toggleExpanded = useCallback(() => {
    const willExpand = !isExpanded;

    if (willExpand && contentRef.current) {
      let scrollContainer: HTMLElement | null = null;
      let el: HTMLElement | null = contentRef.current.parentElement;
      while (el) {
        if (el.scrollHeight > el.clientHeight) {
          scrollContainer = el;
          break;
        }
        el = el.parentElement;
      }

      // Anchor scroll position during expand so users at the bottom stay there
      if (scrollContainer && isScrolledToBottom(scrollContainer)) {
        const container = scrollContainer;
        const observer = new ResizeObserver(() => {
          container.scrollTop = container.scrollHeight;
        });
        observer.observe(contentRef.current);
        setTimeout(() => observer.disconnect(), 350);
      }
    }

    setIsExpanded(willExpand);
  }, [isExpanded]);

  useImperativeHandle(ref, () => ({ toggle: toggleExpanded }), [
    toggleExpanded,
  ]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { t: Date.now(), x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchStartRef.current.x);
    const dy = Math.abs(t.clientY - touchStartRef.current.y);
    // Cancel if the finger moved enough to be a scroll gesture
    if (dx > 10 || dy > 10) touchStartRef.current = null;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const elapsed = Date.now() - start.t;
      // Stay well below the 400ms long-press threshold so we never fire alongside haptics
      if (elapsed >= 380) return;
      // Ignore taps on interactive elements — let them handle their own events
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, select, textarea, video, audio"))
        return;
      // Prevent the browser's synthetic click event that would fire after touchend
      e.preventDefault();
      toggleExpanded();
    },
    [toggleExpanded],
  );

  return (
    <div
      className="collapsible-message"
      onTouchStart={isMobile && needsCollapsing ? handleTouchStart : undefined}
      onTouchMove={isMobile && needsCollapsing ? handleTouchMove : undefined}
      onTouchEnd={isMobile && needsCollapsing ? handleTouchEnd : undefined}
    >
      <div className="relative">
        <div
          ref={contentRef}
          className="overflow-hidden"
          style={{
            maxHeight: isExpanded
              ? `${contentHeight}px`
              : needsCollapsing
                ? collapsedMaxHeight
                : "none",
            transition: allowTransitionRef.current
              ? "max-height 300ms ease-in-out"
              : "none",
          }}
        >
          <div ref={measuredContentRef}>{content}</div>
        </div>
        {needsCollapsing && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-14 message-fade pointer-events-none" />
        )}
      </div>
      {needsCollapsing && (
        <>
          {!isExpanded && <div className="border-b border-white/30" />}
          <div className="flex justify-start mt-0.5 ml-3">
            <button
              onClick={toggleExpanded}
              title={isExpanded ? t`Show less` : t`Read more`}
              className="opacity-80 hover:opacity-100 transition-opacity p-0.5 rounded"
            >
              <ChevronDownIcon
                className={`w-5 h-5 text-discord-text-muted transition-transform duration-300 ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>
        </>
      )}
    </div>
  );
});
CollapsibleMessage.displayName = "CollapsibleMessage";
