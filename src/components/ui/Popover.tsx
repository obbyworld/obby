import type React from "react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useSwipeToDismiss } from "../../hooks/useSwipeToDismiss";

// We pin the panel to its trigger for a mouse and show a bottom sheet on touch,
// and we handle escape and outside-press dismissal here so callers pass only content.
export interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** Trigger or pointer position to anchor against on desktop. Ignored in the mobile sheet. */
  anchor: PopoverAnchor | null;
  children: ReactNode;
  /** Panel width on desktop (px), or "auto" to fit the content. The sheet is always full-width. */
  width?: number | "auto";
  /** Optional sticky title bar shown above the scroll body. */
  title?: ReactNode;
  /** Slot on the right of the title bar (e.g. a count). */
  titleAdornment?: ReactNode;
  /** Extra classes for the scroll body (callers cap height here for the sheet). */
  bodyClassName?: string;
  role?: "menu" | "dialog";
  /** Desktop placement: under the trigger, or beside it for rows and submenus. */
  placement?: PopoverPlacement;
}

export type PopoverPlacement = "below" | "side";

export type PopoverAnchor = HTMLElement | { x: number; y: number };

const rectOf = (anchor: PopoverAnchor): DOMRect =>
  anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect()
    : new DOMRect(anchor.x, anchor.y, 0, 0);

export const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;
const MIN_PANEL_HEIGHT = 160;
const AUTO_MIN_WIDTH = 180;
const AUTO_MAX_WIDTH = 280;
// Top layer, level with modals; the sheet scrim sits just under its panel.
const Z_INDEX = 100000;

export function placePanel(
  rect: DOMRect,
  width: number,
  placement: PopoverPlacement,
) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(x, vw - width - VIEWPORT_MARGIN));

  const fitsRight = rect.right + ANCHOR_GAP + width <= vw - VIEWPORT_MARGIN;
  const fitsLeft = rect.left - ANCHOR_GAP - width >= VIEWPORT_MARGIN;
  if (placement === "side" && (fitsRight || fitsLeft)) {
    const left = clampX(
      fitsRight ? rect.right + ANCHOR_GAP : rect.left - ANCHOR_GAP - width,
    );
    const maxHeight = vh - 2 * VIEWPORT_MARGIN;
    // We pull the panel up by the menu padding so its first item lines up with the trigger.
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.top - 6, vh - VIEWPORT_MARGIN - MIN_PANEL_HEIGHT),
    );
    return {
      left,
      maxHeight: maxHeight - (top - VIEWPORT_MARGIN),
      verticalStyle: { top },
    };
  }

  // We grow the panel away from the nearer screen edge so it starts at the trigger.
  const isTriggerOnLeft = rect.left + rect.width / 2 < vw / 2;
  const left = clampX(isTriggerOnLeft ? rect.left : rect.right - width);
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
  return { left, maxHeight, verticalStyle };
}

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
  placement = "below",
}) => {
  const isMobile = useIsTouchInput();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const swipeRef = useSwipeToDismiss(onClose);
  const setPanel = useCallback(
    (el: HTMLDivElement | null) => {
      panelRef.current = el;
      swipeRef(el);
    },
    [swipeRef],
  );
  // Recompute the anchored position when the viewport shifts under the panel.
  const [, reflow] = useReducer((n: number) => n + 1, 0);
  const [measuredWidth, setMeasuredWidth] = useState(AUTO_MIN_WIDTH);

  // An auto-width panel fits its content, so we measure it before paint and
  // place it with the real width.
  useLayoutEffect(() => {
    if (!isOpen || width !== "auto" || !panelRef.current) return;
    const actual = Math.round(panelRef.current.getBoundingClientRect().width);
    if (actual !== measuredWidth) setMeasuredWidth(actual);
  });

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // A submenu is its own portaled panel, so we keep every menu open on a
      // press inside any panel.
      if (target.closest?.("[data-popover-panel]")) return;
      if (!(anchor instanceof HTMLElement && anchor.contains(target)))
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
    <div className="section-label flex items-center justify-between gap-2 px-3.5 pt-3 shrink-0">
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
          className="fixed inset-0 scrim animate-in fade-in duration-150"
          style={{ zIndex: Z_INDEX }}
        />
        <div
          ref={setPanel}
          role={role}
          data-popover-panel
          className="fixed inset-x-0 bottom-0 surface-sheet animate-in slide-in-from-bottom duration-200"
          style={{ zIndex: Z_INDEX + 1, maxHeight: "85vh" }}
        >
          <span className="sheet-handle" aria-hidden />
          {titleBar}
          <div
            className={`overflow-y-auto overscroll-contain ${bodyClassName}`}
          >
            {children}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  if (!anchor) return null;

  const isAutoWidth = width === "auto";
  const { left, maxHeight, verticalStyle } = placePanel(
    rectOf(anchor),
    isAutoWidth ? measuredWidth : width,
    placement,
  );
  const widthStyle = isAutoWidth
    ? {
        width: "max-content",
        minWidth: AUTO_MIN_WIDTH,
        maxWidth: AUTO_MAX_WIDTH,
      }
    : { width };

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      data-popover-panel
      className="fixed flex flex-col surface-floating overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={{
        left,
        maxHeight,
        zIndex: Z_INDEX,
        ...widthStyle,
        ...verticalStyle,
      }}
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
