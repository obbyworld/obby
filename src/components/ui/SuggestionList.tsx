import type React from "react";
import { useEffect, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { placePanel, VIEWPORT_MARGIN } from "./Popover";

type SuggestionPlacement = "above" | "below" | "inline";

interface SuggestionListProps<T> {
  title: React.ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  anchor?: HTMLElement | null;
  // "below" floats under the anchor at its width; "inline" sits in the page flow.
  placement?: SuggestionPlacement;
  // Positions the list itself when it has no anchor.
  className?: string;
  // Lets an input point at the list and its highlighted option.
  id?: string;
  rowClassName?: string;
  // Sits inside a panel that already draws the surface, so it adds none.
  embedded?: boolean;
}

const GAP_PX = 6;
const SIDE_GUTTER_PX = 8;

// The list spans the composer and fills the space between the chat header and the composer.
export function placeAboveComposer(
  composer: Pick<DOMRect, "top" | "left" | "right">,
  viewport: { width: number; height: number },
  headerBottom: number,
): React.CSSProperties {
  return {
    bottom: viewport.height - composer.top + GAP_PX,
    left: composer.left + SIDE_GUTTER_PX,
    right: viewport.width - composer.right + SIDE_GUTTER_PX,
    maxHeight: Math.max(0, composer.top - headerBottom - 2 * GAP_PX),
  };
}

function getListStyle(
  rect: DOMRect | undefined,
  placement: SuggestionPlacement,
  composerRect: DOMRect | undefined,
): React.CSSProperties | undefined {
  if (!rect || placement === "inline") return undefined;
  if (placement === "above") {
    if (composerRect) {
      const headerBottom =
        document.querySelector(".chat-header")?.getBoundingClientRect()
          .bottom ?? 0;
      return placeAboveComposer(
        composerRect,
        { width: window.innerWidth, height: window.innerHeight },
        headerBottom,
      );
    }
    return { bottom: window.innerHeight - rect.top + GAP_PX, left: rect.left };
  }
  const width = Math.min(rect.width, window.innerWidth - 2 * VIEWPORT_MARGIN);
  const { left, verticalStyle } = placePanel(rect, width, "below");
  return { ...verticalStyle, left, width };
}

export function SuggestionList<T>({
  title,
  items,
  getKey,
  selectedIndex,
  onHover,
  onPick,
  renderItem,
  anchor,
  placement = "above",
  className = "",
  id,
  rowClassName = "",
  embedded = false,
}: SuggestionListProps<T>) {
  const isCompact = useMediaQuery() || useIsTouchInput();
  const selectedRef = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we scroll whenever the highlighted row changes
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const [, reposition] = useReducer((n: number) => n + 1, 0);
  // We follow the anchor while the page around it scrolls or resizes.
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchor]);

  const rect = anchor?.getBoundingClientRect();
  // An anchor that has not been laid out yet would park the list in a corner for a frame.
  if (anchor && (!rect || rect.height === 0)) return null;
  const composerRect =
    isCompact && placement === "above"
      ? (
          anchor?.closest("[data-composer]") ??
          anchor?.parentElement ??
          anchor
        )?.getBoundingClientRect()
      : undefined;
  const isFloatingBelow = placement === "below";
  const titleId = id && `${id}-title`;

  const list = (
    <div
      id={id}
      role="listbox"
      aria-labelledby={titleId}
      data-popover-panel={isFloatingBelow || undefined}
      data-compact={composerRect ? "" : undefined}
      className={`${embedded ? "" : "surface-floating"} ${placement === "inline" ? "w-full" : composerRect ? "z-[9999] flex flex-col" : "z-[9999] min-w-56 max-w-md"} ${rect ? "fixed" : ""} ${className}`}
      style={getListStyle(rect, placement, composerRect)}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div id={titleId} className="section-label">
        {title}
      </div>
      <div className="surface-list pt-0 max-h-72 min-h-0 overflow-y-auto">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={getKey(item)}
              id={id && `${id}-${index}`}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              className={`row-interactive ${rowClassName} ${isSelected ? "row-interactive-active" : ""}`}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(item)}
            >
              {renderItem(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
  // We portal the overlay so the sidebar's scroll box and page transform leave it alone.
  return rect ? createPortal(list, document.body) : list;
}

export default SuggestionList;
