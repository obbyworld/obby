import type { MutableRefObject, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { centerRow, findMessageRow, highlightRow } from "../lib/highlightRow";
import { reportJumpFailure } from "../lib/jumpToMessage";
import useStore from "../store";
import type { Message } from "../types";
import { isScrolledToBottom } from "./useScrollToBottom";

const JUMP_CONTEXT_MESSAGES = 20;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

interface MessageJumpOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  serverId: string;
  isActive: boolean;
  channelMessages: Message[];
  displayedMessages: Message[];
  visibleMessageCount: number;
  setVisibleMessageCount: (count: number) => void;
  windowJumpId: number | undefined;
  wasAtBottomRef: MutableRefObject<boolean>;
}

// After a jump we hold the target row in the middle of the list until the
// reader scrolls, so live messages, media loads and newer pages leave it there.
// isHoldingRef flips in the same commit as the jump, ahead of any effect that reads it.
export function useMessageJump({
  containerRef,
  serverId,
  isActive,
  channelMessages,
  displayedMessages,
  visibleMessageCount,
  setVisibleMessageCount,
  windowJumpId,
  wasAtBottomRef,
}: MessageJumpOptions) {
  const isHoldingRef = useRef(false);
  const heldRowRef = useRef<HTMLElement | null>(null);
  const heldTopRef = useRef(0);
  const heldHeightRef = useRef(0);
  const heldOffsetRef = useRef<number | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const jumpMessageId = useStore((state) => state.ui.messageJump?.messageId);

  const hold = (
    row: HTMLElement | null,
    { keepsOffset = false }: { keepsOffset?: boolean } = {},
  ) => {
    isHoldingRef.current = true;
    heldRowRef.current = row;
    if (row) heldTopRef.current = row.offsetTop;
    heldOffsetRef.current =
      keepsOffset && row
        ? row.offsetTop - (containerRef.current?.scrollTop ?? 0)
        : null;
    heldHeightRef.current = containerRef.current?.clientHeight ?? 0;
    wasAtBottomRef.current = false;
    setIsHolding(true);
  };

  const releaseJump = () => {
    isHoldingRef.current = false;
    heldRowRef.current = null;
    setIsHolding(false);
  };

  // We move the list only when content above the row has shifted it or the
  // list changed size, e.g. it was hidden when we jumped, so the smooth scroll
  // toward it runs undisturbed.
  const keepHeldRowInPlace = () => {
    const row = heldRowRef.current;
    const container = containerRef.current;
    if (!row?.isConnected || !container) return;
    if (
      row.offsetTop === heldTopRef.current &&
      container.clientHeight === heldHeightRef.current
    )
      return;
    heldTopRef.current = row.offsetTop;
    heldHeightRef.current = container.clientHeight;
    if (heldOffsetRef.current === null) centerRow(container, row, "auto");
    else container.scrollTop = row.offsetTop - heldOffsetRef.current;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new window id is a new jump
  useLayoutEffect(() => {
    if (windowJumpId !== undefined) hold(null);
  }, [windowJumpId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: displayedMessages reruns it once the window has grown; refs and setters are stable
  useLayoutEffect(() => {
    keepHeldRowInPlace();
    if (!jumpMessageId || !isActive) return;
    const index = channelMessages.findIndex((m) => m.id === jumpMessageId);
    if (index < 0) return;
    const needed = channelMessages.length - index + JUMP_CONTEXT_MESSAGES;
    if (needed > visibleMessageCount) {
      setVisibleMessageCount(needed);
      return;
    }
    const container = containerRef.current;
    const row = container && findMessageRow(container, jumpMessageId);
    useStore.getState().clearMessageJump();
    if (!container || !row) {
      reportJumpFailure(serverId, "not-found");
      return;
    }
    hold(row);
    highlightRow(container, row);
  }, [jumpMessageId, isActive, displayedMessages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the container ref is stable
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isHolding) return;
    const releaseAtBottom = () => {
      if (container.clientHeight > 0 && isScrolledToBottom(container))
        releaseJump();
    };
    for (const type of USER_SCROLL_EVENTS)
      container.addEventListener(type, releaseJump, { passive: true });
    container.addEventListener("scroll", releaseAtBottom, { passive: true });
    return () => {
      for (const type of USER_SCROLL_EVENTS)
        container.removeEventListener(type, releaseJump);
      container.removeEventListener("scroll", releaseAtBottom);
    };
  }, [isHolding]);

  return {
    isHoldingRef,
    isHoldingJump: isHolding,
    holdRow: hold,
    releaseJump,
    keepHeldRowInPlace,
  };
}
