import type React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";

const TOOLTIP_MAX_WIDTH = 260;
export const TOOLTIP_SHOW_DELAY_MS = 200;

export interface TooltipAnchor {
  x: number;
  y: number;
  bottom: number;
  left: number;
  width: number;
}

export const tooltipAnchorOf = (rect: DOMRect): TooltipAnchor => ({
  x: rect.left + rect.width / 2,
  y: rect.top,
  bottom: rect.bottom,
  left: rect.left,
  width: rect.width,
});

// Every hover hint in the app renders through this panel, so they all share one look.
export const TooltipPanel: React.FC<{
  anchor: TooltipAnchor;
  id: string;
  children: React.ReactNode;
}> = ({ anchor, id, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 6;
    // A hint narrower than its element starts where the element's text starts.
    const preferredLeft =
      anchor.width > width ? anchor.left : anchor.x - width / 2;
    const left = Math.max(
      8,
      Math.min(preferredLeft, window.innerWidth - width - 8),
    );
    const above = anchor.y - height - gap;
    const top = above >= 8 ? above : anchor.bottom + gap;
    setPos({ left, top, visibility: "visible" });
  }, [anchor]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{
        position: "fixed",
        zIndex: 9999,
        // A long hint on a wide element, like a channel topic, spreads to its width.
        maxWidth: Math.min(
          Math.max(TOOLTIP_MAX_WIDTH, anchor.width),
          window.innerWidth - 16,
        ),
        ...pos,
      }}
      className="tooltip-surface"
    >
      {children}
    </div>
  );
};

export const HoverTooltip: React.FC<{
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ content, children, className }) => {
  const [show, setShow] = useState(false);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const descriptionId = `${panelId}-description`;
  // iOS replays a tap as mouseenter and focus, so on touch we open on tap only.
  const isTouch = useIsTouchInput();

  function open() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor(tooltipAnchorOf(rect));
    setShow(true);
  }

  function handleEnter() {
    if (isTouch) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor(tooltipAnchorOf(rect));
    timerRef.current = setTimeout(() => setShow(true), TOOLTIP_SHOW_DELAY_MS);
  }

  function handleLeave() {
    if (isTouch) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(false);
  }

  function handleTap() {
    if (!isTouch) return;
    if (show) setShow(false);
    else open();
  }

  useEffect(() => {
    if (!isTouch || !show) return;
    const closeOutside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOutside, true);
  }, [isTouch, show]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Some of these carry the only explanation a row has, so screen readers get it on any device.
  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-describedby={descriptionId}
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={handleTap}
    >
      {children}
      <span id={descriptionId} className="sr-only">
        {content}
      </span>
      {show &&
        anchor &&
        createPortal(
          <TooltipPanel anchor={anchor} id={panelId}>
            {content}
          </TooltipPanel>,
          document.body,
        )}
    </span>
  );
};

export default HoverTooltip;
