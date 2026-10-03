import type React from "react";
import { useEffect, useRef } from "react";

interface SuggestionListProps<T> {
  title: React.ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  // The list opens above this element, aligned to its left edge.
  anchor?: HTMLElement | null;
  // Positions the list itself when it has no anchor.
  className?: string;
}

const GAP_PX = 6;

export function SuggestionList<T>({
  title,
  items,
  getKey,
  selectedIndex,
  onHover,
  onPick,
  renderItem,
  anchor,
  className = "",
}: SuggestionListProps<T>) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we scroll whenever the highlighted row changes
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const rect = anchor?.getBoundingClientRect();
  // An anchor that has not been laid out yet would park the list in a corner for a frame.
  if (anchor && (!rect || rect.height === 0)) return null;
  const style = rect
    ? { bottom: window.innerHeight - rect.top + GAP_PX, left: rect.left }
    : undefined;

  return (
    <div
      role="listbox"
      className={`surface-floating z-[9999] min-w-56 max-w-md ${rect ? "fixed" : ""} ${className}`}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="section-label">{title}</div>
      <div className="surface-list pt-0 max-h-72 overflow-y-auto">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={getKey(item)}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              className={`row-interactive ${isSelected ? "row-interactive-active" : ""}`}
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
}

export default SuggestionList;
