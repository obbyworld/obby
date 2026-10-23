import type React from "react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface ResizableSidebarProps {
  children: ReactNode;
  isVisible: boolean;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: "left" | "right";
  bypass: boolean;
  onMinReached?: () => void;
  initialWidth?: number;
  onWidthChange?: (width: number) => void;
}

export const ResizableSidebar: React.FC<ResizableSidebarProps> = ({
  children,
  isVisible,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  onMinReached,
  bypass,
  initialWidth,
  onWidthChange,
}) => {
  if (bypass) {
    return children;
  }

  const validateWidth = useCallback(
    (width: number, min: number, max: number, fallback: number): number => {
      if (Number.isNaN(width) || width < min || width > max) {
        return fallback;
      }
      return width;
    },
    [],
  );

  const [width, setWidth] = useState(
    validateWidth(
      initialWidth ?? defaultWidth,
      minWidth,
      maxWidth,
      defaultWidth,
    ),
  );
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  const wasVisible = useRef(isVisible);

  // If we are toggling visibility back on, reset the width
  useEffect(() => {
    if (isVisible && !wasVisible.current) {
      setWidth(
        validateWidth(
          initialWidth ?? defaultWidth,
          minWidth,
          maxWidth,
          defaultWidth,
        ),
      );
    }
    wasVisible.current = isVisible;
  }, [
    isVisible,
    defaultWidth,
    initialWidth,
    minWidth,
    maxWidth,
    validateWidth,
  ]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = width;
      e.preventDefault();
      e.stopPropagation();
    },
    [width],
  );

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = resizeStartX.current - e.clientX;
      const newWidth = Math.min(
        Math.max(
          resizeStartWidth.current + (side === "left" ? -deltaX : deltaX),
          minWidth,
        ),
        maxWidth,
      );
      if (newWidth <= minWidth && onMinReached) {
        onMinReached();
      }
      setWidth(newWidth);
      e.preventDefault();
      e.stopPropagation();
    },
    [isResizing, minWidth, maxWidth, side, onMinReached],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    onWidthChange?.(width);
  }, [width, onWidthChange]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", handleResizeEnd);
      return () => {
        document.removeEventListener("mousemove", handleResize);
        document.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  // We widen the grab area past the edge so it is easy to hit, and keep the visuals on the edge.
  const handleStyle =
    side === "left"
      ? "-right-1.5 cursor-col-resize"
      : "-left-1.5 cursor-col-resize";

  return (
    <div
      className="flex-shrink-0 h-full flex flex-col relative z-20"
      data-testid="resizable-sidebar"
      style={{
        width: isVisible ? `${width}px` : "0",
        display: isVisible ? "flex" : "none",
      }}
    >
      {/* Resize handle */}
      <div
        className={`absolute top-0 w-3 h-full z-30 group ${handleStyle} ${
          !isVisible ? "hidden" : ""
        }`}
        onMouseDown={handleResizeStart}
        data-testid="resize-handle"
      >
        <div
          className={`absolute top-0 w-1 h-full transition-all duration-150 ${
            side === "left" ? "right-1.5" : "left-1.5"
          } ${
            isResizing
              ? side === "left"
                ? "shadow-[inset_-3px_0_8px_rgba(0,0,0,0.5)]"
                : "shadow-[inset_3px_0_8px_rgba(0,0,0,0.5)]"
              : side === "left"
                ? "group-hover:shadow-[inset_-2px_0_6px_rgba(0,0,0,0.35)]"
                : "group-hover:shadow-[inset_2px_0_6px_rgba(0,0,0,0.35)]"
          }`}
        >
          <div
            className={`absolute ${side === "left" ? "right-0" : "left-0"} w-[1px] h-full bg-discord-dark-200`}
          />
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
};
