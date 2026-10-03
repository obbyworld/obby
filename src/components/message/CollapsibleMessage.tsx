import { plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { isScrolledToBottom } from "../../hooks/useScrollToBottom";
import { useShortTap } from "../../hooks/useShortTap";

export const COLLAPSIBLE_MAX_LINES = 8;

interface CollapsibleMessageProps {
  content: React.ReactNode;
  maxLines?: number;
  // Touch users read a folded message whole; the owner opens it for them.
  onRequestRead?: () => void;
}

function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let el = from.parentElement;
  while (el) {
    if (el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

// Mouse users unfold in place with a sticky "Show less"; touch users open the
// whole message elsewhere so the chat stays still under their thumb.
export const CollapsibleMessage: React.FC<CollapsibleMessageProps> = ({
  content,
  maxLines = COLLAPSIBLE_MAX_LINES,
  onRequestRead,
}) => {
  const isTouch = useIsTouchInput();
  const [isExpanded, setIsExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [lineHeight, setLineHeight] = useState(16);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The outer content box is max-height-clamped, so we measure this unclamped wrapper.
  const measuredContentRef = useRef<HTMLDivElement>(null);
  // Stays false through the first measurement so the initial fold is instant.
  const allowTransitionRef = useRef(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    const measuredContent = measuredContentRef.current;
    if (!element || !measuredContent) return;
    let rafId = 0;

    const measure = () => {
      // jsdom reports clientHeight 0 everywhere, so we only bail when both are 0 (display:none).
      if (element.clientHeight === 0 && measuredContent.scrollHeight === 0) {
        allowTransitionRef.current = false;
        return;
      }
      setLineHeight(
        Number.parseFloat(window.getComputedStyle(element).lineHeight) || 16,
      );
      setContentHeight(measuredContent.scrollHeight);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        allowTransitionRef.current = true;
      });
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(measuredContent);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  const collapsedHeight = lineHeight * maxLines;
  const isCollapsible =
    contentHeight !== null && contentHeight > collapsedHeight;
  const totalLines = Math.round((contentHeight ?? 0) / lineHeight);
  const hiddenLines = Math.max(1, totalLines - maxLines);

  const expand = useCallback(() => {
    const element = contentRef.current;
    const scrollContainer = element && findScrollContainer(element);
    // We keep a reader at the bottom pinned there while the message grows.
    if (element && scrollContainer && isScrolledToBottom(scrollContainer)) {
      const observer = new ResizeObserver(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
      observer.observe(element);
      setTimeout(() => observer.disconnect(), 350);
    }
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    const root = rootRef.current;
    const scrollContainer = root && findScrollContainer(root);
    // We pin the message top before folding, so the fold shrinks below the
    // reader and they stay on this message.
    if (
      root &&
      scrollContainer &&
      root.getBoundingClientRect().top <
        scrollContainer.getBoundingClientRect().top
    )
      root.scrollIntoView({ block: "start" });
    setIsExpanded(false);
  }, []);

  const canRead = isTouch && isCollapsible && !!onRequestRead;
  const isOpenInline = isExpanded && !canRead;
  const shortTap = useShortTap(() => onRequestRead?.());

  return (
    <div ref={rootRef} className="collapsible-message">
      <div className="relative" {...(canRead ? shortTap : {})}>
        <div
          ref={contentRef}
          className="overflow-hidden"
          style={{
            maxHeight: isOpenInline
              ? `${contentHeight}px`
              : isCollapsible
                ? `${collapsedHeight}px`
                : "none",
            transition: allowTransitionRef.current
              ? "max-height 300ms ease-in-out"
              : "none",
          }}
        >
          <div ref={measuredContentRef}>{content}</div>
        </div>
        {isCollapsible && !isOpenInline && (
          <div className="absolute bottom-0 left-0 right-0 h-14 message-fade pointer-events-none" />
        )}
      </div>
      {canRead && (
        <button
          type="button"
          className="chip-action mt-1.5 min-h-11"
          onClick={onRequestRead}
        >
          <Trans>Read all</Trans>
          <span className="row-meta">
            {plural(totalLines, { one: "# line", other: "# lines" })}
          </span>
        </button>
      )}
      {isCollapsible && !canRead && !isExpanded && (
        <div className="relative -mt-3.5 flex justify-center">
          <button type="button" className="chip-action" onClick={expand}>
            <Trans>Show more</Trans>
            <span className="row-meta">
              {plural(hiddenLines, {
                one: "# more line",
                other: "# more lines",
              })}
            </span>
            <FaChevronDown className="text-[10px]" />
          </button>
        </div>
      )}
      {isCollapsible && isOpenInline && (
        <div className="sticky bottom-3 z-10 mt-2 flex justify-center">
          <button type="button" className="chip-action" onClick={collapse}>
            <FaChevronUp className="text-[10px]" />
            <Trans>Show less</Trans>
          </button>
        </div>
      )}
    </div>
  );
};
