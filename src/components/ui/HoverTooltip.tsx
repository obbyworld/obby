import type React from "react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_MAX_WIDTH = 260;
const SHOW_DELAY_MS = 200;

// Portaled tooltip pinned above its trigger. Shared by reaction pills and inline
// message affordances so every hover hint reads identically.
const TooltipPanel: React.FC<{
  anchor: { x: number; y: number };
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
    const left = Math.max(
      8,
      Math.min(anchor.x - width / 2, window.innerWidth - width - 8),
    );
    const top = Math.max(8, anchor.y - height - gap);
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
        maxWidth: TOOLTIP_MAX_WIDTH,
        ...pos,
      }}
      className="pointer-events-none rounded-lg bg-discord-dark-100 px-3 py-2 text-sm text-white shadow-[0_8px_32px_rgba(0,0,0,0.7)] ring-1 ring-white/10"
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
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  function handleEnter() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
    timerRef.current = setTimeout(() => setShow(true), SHOW_DELAY_MS);
  }

  function handleLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(false);
  }

  // Focusable and described, so the hint is not a mouse-only affordance. Some of
  // these carry the only explanation a row has (an undecryptable message says
  // nothing else about why it cannot be read).
  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-describedby={show ? panelId : undefined}
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
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
