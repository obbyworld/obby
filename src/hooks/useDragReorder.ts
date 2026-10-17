import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptic";

interface UseDragReorderConfig<T> {
  items: T[];
  getItemId: (item: T) => string;
  onReorder: (
    reorderedIds: string[],
    draggedId: string,
    targetId: string,
  ) => void;
  disabled?: boolean;
  // Drag handles can start on touch at once, since they never scroll the list.
  touchDelay?: number;
}

interface UseDragReorderReturn {
  handlePointerDown: (e: React.PointerEvent, itemId: string) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  getItemProps: (itemId: string) => {
    "data-draggable-item": true;
    "data-item-id": string;
    onPointerDown: (e: React.PointerEvent) => void;
    className: string;
    style?: React.CSSProperties;
  };
  draggedItemId: string | null;
  dragOverItemId: string | null;
  isDragging: boolean;
}

interface TouchState {
  startY: number;
  startX: number;
  itemId: string | null;
  initialIndex: number;
  hasMoved: boolean;
  grabOffsetFromCenter: number;
  itemRects: Map<string, DOMRect> | null;
  isPressing: boolean;
  pointerId: number | null;
  pointerType: string;
}

const LONG_PRESS_DELAY = 450; // ms before touch drag activates
const LONG_PRESS_MOVE_LIMIT = 8; // px — cancel long press if finger moves this far first
const SCROLL_ZONE = 80; // px from container edge where auto-scroll kicks in
const MAX_SCROLL_SPEED = 14; // px per animation frame at the edge

function cacheItemRects(): Map<string, DOMRect> {
  const allItems = document.querySelectorAll<HTMLElement>(
    "[data-draggable-item]",
  );
  const rects = new Map<string, DOMRect>();
  for (const item of allItems) {
    const id = item.getAttribute("data-item-id");
    if (id) rects.set(id, item.getBoundingClientRect());
  }
  return rects;
}

function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function useDragReorder<T>({
  items,
  getItemId,
  onReorder,
  disabled = false,
  touchDelay = LONG_PRESS_DELAY,
}: UseDragReorderConfig<T>): UseDragReorderReturn {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const dragState = useRef<TouchState>({
    startY: 0,
    startX: 0,
    itemId: null,
    initialIndex: -1,
    hasMoved: false,
    grabOffsetFromCenter: 0,
    itemRects: null,
    isPressing: false,
    pointerId: null,
    pointerType: "",
  });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so the timer callback can call setPointerCapture after the delay
  const pressTargetRef = useRef<HTMLElement | null>(null);
  // The nearest scrollable ancestor of the dragged item
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  // Auto-scroll RAF state: speed (px/frame) and frame id
  const autoScrollRef = useRef<{ speed: number; frameId: number } | null>(null);
  // Non-passive touchmove listener attached at pointerdown (not at drag activation).
  // iOS decides scroll vs gesture immediately — the listener must exist before that
  // decision is made. It only calls preventDefault once hasMoved (drag active).
  const preventScrollRef = useRef<((e: TouchEvent) => void) | null>(null);

  const cancelAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current.frameId);
      autoScrollRef.current = null;
    }
  }, []);

  const stopPreventingScroll = useCallback(() => {
    if (preventScrollRef.current) {
      document.removeEventListener("touchmove", preventScrollRef.current);
      preventScrollRef.current = null;
    }
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    dragState.current.isPressing = false;
  }, []);

  const activateDrag = useCallback(() => {
    const target = pressTargetRef.current;
    const { pointerId, itemId } = dragState.current;
    if (!target || pointerId === null || !itemId) return;

    target.setPointerCapture(pointerId);
    dragState.current.isPressing = false;
    dragState.current.hasMoved = true; // long-press committed the drag; skip the distance threshold
    dragState.current.itemRects = cacheItemRects();
    scrollContainerRef.current = findScrollContainer(target);
    haptic("medium");

    setIsDragging(true);
    setDraggedItemId(itemId);
  }, []);

  // Auto-scroll loop: scrolls the container and refreshes item rects so drop
  // targeting stays accurate while the list moves under the pointer.
  const startAutoScroll = useCallback((speed: number) => {
    if (autoScrollRef.current) {
      autoScrollRef.current.speed = speed;
      return;
    }
    const loop = () => {
      const container = scrollContainerRef.current;
      if (!autoScrollRef.current || !container) return;
      container.scrollTop += autoScrollRef.current.speed;
      dragState.current.itemRects = cacheItemRects();
      autoScrollRef.current.frameId = requestAnimationFrame(loop);
    };
    autoScrollRef.current = { speed, frameId: requestAnimationFrame(loop) };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, itemId: string) => {
      if (disabled || e.button !== 0) return;

      const target = e.currentTarget as HTMLElement;
      const index = items.findIndex((item) => getItemId(item) === itemId);
      const rect = target.getBoundingClientRect();
      const grabOffsetFromCenter = e.clientY - (rect.top + rect.height / 2);

      dragState.current = {
        startY: e.clientY,
        startX: e.clientX,
        itemId,
        initialIndex: index,
        hasMoved: false,
        grabOffsetFromCenter,
        itemRects: null,
        isPressing: e.pointerType === "touch",
        pointerId: e.pointerId,
        pointerType: e.pointerType,
      };

      if (e.pointerType === "touch") {
        // On touch: wait for long press before claiming the gesture.
        // This lets the scroll container handle fast swipes normally.
        pressTargetRef.current = target;
        longPressTimer.current = setTimeout(activateDrag, touchDelay);
        // The listener must exist before iOS decides "scroll vs gesture".
        // It only calls preventDefault once hasMoved is true (drag active),
        // so normal scroll is unaffected during the waiting period.
        const preventScroll = (ev: TouchEvent) => {
          if (dragState.current.hasMoved) ev.preventDefault();
        };
        document.addEventListener("touchmove", preventScroll, {
          passive: false,
        });
        preventScrollRef.current = preventScroll;
      } else {
        // Mouse: immediate drag (desktop behaviour unchanged)
        target.setPointerCapture(e.pointerId);
        scrollContainerRef.current = findScrollContainer(target);
      }
    },
    [disabled, items, getItemId, activateDrag, touchDelay],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !dragState.current.itemId) return;

      if (dragState.current.isPressing) {
        // Cancel the pending long-press if the finger scrolled away intentionally
        const dx = Math.abs(e.clientX - dragState.current.startX);
        const dy = Math.abs(e.clientY - dragState.current.startY);
        if (dx > LONG_PRESS_MOVE_LIMIT || dy > LONG_PRESS_MOVE_LIMIT) {
          cancelLongPress();
          dragState.current.itemId = null;
        }
        return;
      }

      if (
        dragState.current.pointerType !== "touch" &&
        !dragState.current.hasMoved
      ) {
        const deltaY = Math.abs(e.clientY - dragState.current.startY);
        if (deltaY > 5) {
          dragState.current.hasMoved = true;
          dragState.current.itemRects = cacheItemRects();
          setIsDragging(true);
          setDraggedItemId(dragState.current.itemId);
        }
      }

      if (dragState.current.hasMoved) {
        setDragOffset(e.clientY - dragState.current.startY);

        // Auto-scroll when pointer is near the top or bottom of the list container
        const container = scrollContainerRef.current;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const distFromTop = e.clientY - containerRect.top;
          const distFromBottom = containerRect.bottom - e.clientY;

          if (distFromTop < SCROLL_ZONE && distFromTop >= 0) {
            // Speed ramps from 0 (at zone edge) to MAX (at container edge)
            const speed = -Math.round(
              ((SCROLL_ZONE - distFromTop) / SCROLL_ZONE) * MAX_SCROLL_SPEED,
            );
            startAutoScroll(speed);
          } else if (distFromBottom < SCROLL_ZONE && distFromBottom >= 0) {
            const speed = Math.round(
              ((SCROLL_ZONE - distFromBottom) / SCROLL_ZONE) * MAX_SCROLL_SPEED,
            );
            startAutoScroll(speed);
          } else {
            cancelAutoScroll();
          }
        }

        const rects = dragState.current.itemRects;
        if (!rects || rects.size === 0) return;

        const adjustedY = e.clientY - dragState.current.grabOffsetFromCenter;

        let targetId: string | null = null;
        let minDistance = Number.POSITIVE_INFINITY;

        for (const [id, rect] of rects) {
          const itemCenter = rect.top + rect.height / 2;
          const distance = Math.abs(adjustedY - itemCenter);
          if (distance < minDistance) {
            minDistance = distance;
            targetId = id;
          }
        }

        if (targetId) {
          setDragOverItemId(targetId);
        }
      }
    },
    [disabled, cancelLongPress, startAutoScroll, cancelAutoScroll],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;

      cancelLongPress();
      cancelAutoScroll();
      stopPreventingScroll();

      const target = e.currentTarget as HTMLElement;
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        // Already released or never captured (touch long-press cancelled)
      }

      if (dragState.current.hasMoved) {
        // pointerup is followed by a click event — suppress it so releasing a drag
        // doesn't also select the channel. Capture phase runs before React handlers.
        document.addEventListener("click", (ev) => ev.stopPropagation(), {
          capture: true,
          once: true,
        });
      }

      if (
        dragState.current.hasMoved &&
        dragState.current.itemId &&
        dragOverItemId
      ) {
        const draggedId = dragState.current.itemId;

        if (draggedId !== dragOverItemId) {
          const draggedIndex = items.findIndex(
            (item) => getItemId(item) === draggedId,
          );
          const targetIndex = items.findIndex(
            (item) => getItemId(item) === dragOverItemId,
          );

          if (draggedIndex !== -1 && targetIndex !== -1) {
            const reordered = [...items];
            const [removed] = reordered.splice(draggedIndex, 1);
            reordered.splice(targetIndex, 0, removed);
            onReorder(reordered.map(getItemId), draggedId, dragOverItemId);
          }
        }
      }

      dragState.current = {
        startY: 0,
        startX: 0,
        itemId: null,
        initialIndex: -1,
        hasMoved: false,
        grabOffsetFromCenter: 0,
        itemRects: null,
        isPressing: false,
        pointerId: null,
        pointerType: "",
      };
      pressTargetRef.current = null;
      scrollContainerRef.current = null;
      setIsDragging(false);
      setDraggedItemId(null);
      setDragOverItemId(null);
      setDragOffset(0);
    },
    [
      disabled,
      cancelLongPress,
      cancelAutoScroll,
      stopPreventingScroll,
      dragOverItemId,
      items,
      getItemId,
      onReorder,
    ],
  );

  const getItemProps = useCallback(
    (itemId: string) => {
      const isDraggingThis = draggedItemId === itemId && isDragging;

      const draggedIndex = items.findIndex(
        (item) => getItemId(item) === draggedItemId,
      );
      const targetIndex = items.findIndex((item) => getItemId(item) === itemId);
      const isTargetBelow = targetIndex > draggedIndex;

      let isDropTargetAbove = false;
      let isDropTargetBelow = false;

      if (dragOverItemId === itemId && isDragging) {
        if (draggedItemId === itemId) {
          isDropTargetBelow = true;
        } else {
          if (!isTargetBelow) {
            isDropTargetAbove = true;
          } else {
            isDropTargetBelow = true;
          }
        }
      }

      return {
        "data-draggable-item": true as const,
        "data-item-id": itemId,
        onPointerDown: (e: React.PointerEvent) => handlePointerDown(e, itemId),
        className: [
          "draggable-item",
          isDraggingThis && "is-dragging",
          isDropTargetAbove && "is-drop-target-above",
          isDropTargetBelow && "is-drop-target-below",
        ]
          .filter(Boolean)
          .join(" "),
        // translateY follows the pointer; scale/rotate come from the CSS animation
        // using individual transform properties which compose with (not override) this.
        style: isDraggingThis
          ? { transform: `translateY(${dragOffset}px) translateZ(0)` }
          : undefined,
      };
    },
    [
      handlePointerDown,
      draggedItemId,
      isDragging,
      dragOverItemId,
      dragOffset,
      items,
      getItemId,
    ],
  );

  useEffect(() => {
    if (isDragging) {
      document.body.classList.add("no-select");
      return () => {
        document.body.classList.remove("no-select");
      };
    }
  }, [isDragging]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      stopPreventingScroll();
      cancelAutoScroll();
    };
  }, [stopPreventingScroll, cancelAutoScroll]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    getItemProps,
    draggedItemId,
    dragOverItemId,
    isDragging,
  };
}
