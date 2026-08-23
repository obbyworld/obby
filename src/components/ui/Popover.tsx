import type React from "react";
import { type ReactNode, useEffect, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";

// Anchored dropdown primitive: a portaled panel pinned to a trigger on pointer
// widths, a bottom sheet on touch. Owns its own escape / outside-press
// dismissal so callers supply only content.
export interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** Trigger to anchor against on desktop. Ignored in the mobile sheet. */
  anchor: HTMLElement | null;
  children: ReactNode;
  /** Panel width on desktop (px). The sheet is always full-width. */
  width?: number;
  /** Optional sticky title bar shown above the scroll body. */
  title?: ReactNode;
  /** Slot on the right of the title bar (e.g. a count). */
  titleAdornment?: ReactNode;
  /** Extra classes for the scroll body (callers cap height here for the sheet). */
  bodyClassName?: string;
  role?: "menu" | "dialog";
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;
const MIN_PANEL_HEIGHT = 160;
// Top layer, level with modals; the sheet scrim sits just under its panel.
const Z_INDEX = 100000;

export const Popover: React.FC<PopoverProps> = ({
  isOpen,
  onClose,
  anchor,
  children,
  width = 320,
  title,
  titleAdornment,
  bodyClassName = "",
  role = "dialog",
}) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Recompute the anchored position when the viewport shifts under the panel.
  const [, reflow] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchor?.contains(target))
        onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [isOpen, anchor]);

  if (!isOpen) return null;

  const titleBar = title ? (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-discord-dark-400 text-xs uppercase tracking-wide text-discord-text-muted shrink-0">
      <span className="truncate">{title}</span>
      {titleAdornment && <span className="shrink-0">{titleAdornment}</span>}
    </div>
  ) : null;

  if (isMobile) {
    return createPortal(
      <>
        <div
          aria-hidden="true"
          onClick={() => onCloseRef.current()}
          className="fixed inset-0 bg-black/60 animate-in fade-in duration-150"
          style={{ zIndex: Z_INDEX }}
        />
        <div
          ref={panelRef}
          role={role}
          className="fixed inset-x-0 bottom-0 flex flex-col bg-discord-dark-300 border-t border-discord-dark-500 rounded-t-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
          style={{ zIndex: Z_INDEX + 1, maxHeight: "85vh" }}
        >
          <div className="flex justify-center pt-2 pb-1 shrink-0" aria-hidden>
            <span className="w-9 h-1 rounded-full bg-discord-dark-500" />
          </div>
          {titleBar}
          <div
            className={`overflow-y-auto overscroll-contain ${bodyClassName}`}
            style={{ paddingBottom: "var(--safe-area-inset-bottom, 0px)" }}
          >
            {children}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  if (!anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rawX = rect.right - width;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rawX, vw - width - VIEWPORT_MARGIN),
  );
  const belowTop = rect.bottom + ANCHOR_GAP;
  const belowSpace = vh - belowTop - VIEWPORT_MARGIN;
  const aboveSpace = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const flipUp = belowSpace < MIN_PANEL_HEIGHT && aboveSpace > belowSpace;
  const maxHeight = Math.max(
    MIN_PANEL_HEIGHT,
    flipUp ? aboveSpace : belowSpace,
  );
  const verticalStyle = flipUp
    ? { bottom: vh - rect.top + ANCHOR_GAP }
    : { top: belowTop };

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      className="fixed flex flex-col bg-discord-dark-300 border border-discord-dark-500 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={{ left, width, maxHeight, zIndex: Z_INDEX, ...verticalStyle }}
    >
      {titleBar}
      <div className={`overflow-y-auto overscroll-contain ${bodyClassName}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Popover;
