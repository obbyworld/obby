import { useLingui } from "@lingui/react/macro";
import type * as React from "react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaArrowDown } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useMessageJump } from "../../hooks/useMessageJump";
import {
  SCROLL_TOLERANCE,
  useScrollToBottom,
} from "../../hooks/useScrollToBottom";
import { buildMarkdownFromSelection } from "../../lib/chatMarkdownCopy";
import { groupConsecutiveEvents } from "../../lib/eventGrouping";
import { findMessageRow } from "../../lib/highlightRow";
import { shouldShowMessageHeader } from "../../lib/messageGrouping";
import useStore from "../../store";
import {
  loadNewerMessages,
  loadOlderMessages,
  showPresent,
  showSavedHistory,
} from "../../store/handlers/history";
import { serverSupportsChathistory } from "../../store/helpers";
import type { Message as MessageType } from "../../types";
import { CollapsedEventMessage } from "../message/CollapsedEventMessage";
import { MessageItem } from "../message/MessageItem";
import LoadingSpinner from "../ui/LoadingSpinner";
import { ScrollToBottomButton } from "../ui/ScrollToBottomButton";

export const DEFAULT_VISIBLE_MESSAGE_COUNT = 100;

// Stable empty array — prevents selector from returning a new [] on every render
// when the channel has no messages yet (undefined ?? [] would create a new ref each time).
const EMPTY_MESSAGES: import("../../types").Message[] = [];

export interface ChannelMessageListHandle {
  setAtBottom: () => void;
  scrollToBottom: () => void;
  getScrollState: () => {
    scrollTop: number;
    isAtBottom: boolean;
    visibleCount: number;
  };
}

interface ChannelMessageListProps {
  channelKey: string;
  serverId: string;
  channelId: string | null;
  privateChatId: string | null;
  isActive: boolean;
  isMemberListVisible: boolean;
  onReply: (msg: MessageType | null) => void;
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarEl?: Element | null,
  ) => void;
  onIrcLinkClick: (url: string) => void;
  onReactClick: (msg: MessageType, el: Element) => void;
  onReactionUnreact: (emoji: string, msg: MessageType) => void;
  onOpenReactionModal: (
    msg: MessageType,
    position: { x: number; y: number },
  ) => void;
  onDirectReaction: (emoji: string, msg: MessageType) => void;
  onRedactMessage: (msg: MessageType) => void;
  onOpenProfile: (username: string) => void;
  joinChannel: (serverId: string, channelName: string) => void;
  highlightedMessageId?: string;
  searchHitMessageId?: string;
  // undefined = first visit; null = was at bottom; object = restore to saved position
  initialScrollState?: { scrollTop: number; visibleCount: number } | null;
}

export const ChannelMessageList = forwardRef<
  ChannelMessageListHandle,
  ChannelMessageListProps
>(
  (
    {
      channelKey,
      serverId,
      channelId,
      privateChatId,
      isActive,
      isMemberListVisible,
      onReply,
      onUsernameContextMenu,
      onIrcLinkClick,
      onReactClick,
      onReactionUnreact,
      onOpenReactionModal,
      onDirectReaction,
      onRedactMessage,
      onOpenProfile,
      joinChannel,
      highlightedMessageId,
      searchHitMessageId,
      initialScrollState,
    },
    ref,
  ) => {
    const { t } = useLingui();
    const [visibleMessageCount, setVisibleMessageCount] = useState(
      initialScrollState?.visibleCount ?? DEFAULT_VISIBLE_MESSAGE_COUNT,
    );
    // Ref mirror so getScrollState closure always reads the current value without needing it as a dep.
    const visibleMessageCountRef = useRef(visibleMessageCount);
    visibleMessageCountRef.current = visibleMessageCount;
    // Distinguishes initial join (full-screen spinner) from subsequent "load more" (button spinner).
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const isFetchingMoreRef = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesInnerRef = useRef<HTMLDivElement>(null);
    // prev scrollHeight for prepend delta-correction.
    const prevScrollHeightRef = useRef(0);
    // Ref mirror of isScrolledUp — lets useLayoutEffect closures read current value
    // without listing isScrolledUp as a dep (which would re-run effects on every scroll).
    const isScrolledUpRef = useRef(false);
    const prevFilteredLengthRef = useRef(0);
    const prevFirstMsgIdRef = useRef<string | null>(null);
    // Set when older messages are prepended, so the correction below knows a
    // changed first row came from a prepend; a bottom append also slides slice(-N).
    const pendingPrependRef = useRef(false);
    const droppedRowsAnchorRef = useRef<{ id: string; top: number } | null>(
      null,
    );
    // Shared scrollHeight baseline between the delta-correction layout effect and the inner
    // ResizeObserver. When scrollTop is corrected after a prepend, we update this so the RO's
    // "was at bottom" check is not fooled by the adjusted scrollTop vs its stale prevSH.
    const resizeObserverPrevSHRef = useRef(0);

    const channelMessages = useStore(
      useCallback(
        (state) => state.messages[channelKey] ?? EMPTY_MESSAGES,
        [channelKey],
      ),
    );
    const servers = useStore((state) => state.servers);
    const mobileViewActiveColumn = useStore(
      (state) => state.ui.mobileViewActiveColumn,
    );

    const channel = useMemo(
      () =>
        channelId
          ? (servers
              .find((s) => s.id === serverId)
              ?.channels.find((c) => c.id === channelId) ?? null)
          : null,
      [servers, serverId, channelId],
    );
    const privateChat = useMemo(
      () =>
        privateChatId
          ? (servers
              .find((s) => s.id === serverId)
              ?.privateChats?.find((pc) => pc.id === privateChatId) ?? null)
          : null,
      [servers, serverId, privateChatId],
    );
    const historyTarget = channel?.name ?? privateChat?.username;
    const isDetached = useStore((state) => !!state.historyWindows[channelKey]);
    const isDetachedRef = useRef(isDetached);
    isDetachedRef.current = isDetached;
    const wasDetachedRef = useRef(isDetached);
    const windowJumpId = useStore(
      (state) => state.historyWindows[channelKey]?.jumpId,
    );
    const isTouch = useIsTouchInput();

    useEffect(() => {
      if (historyTarget) showSavedHistory(useStore, serverId, historyTarget);
    }, [serverId, historyTarget]);

    const { isScrolledUp, wasAtBottomRef, scrollToBottom } = useScrollToBottom(
      messagesContainerRef,
      messagesEndRef,
      { channelId: `${channelId || privateChatId}-${isMemberListVisible}` },
    );

    // Snapshot of the last known scroll position captured while the container was visible.
    // getScrollState() reads this instead of the live DOM because React commits display:none
    // before running cleanup effects, collapsing scrollTop/scrollHeight/clientHeight to 0.
    const lastScrollTopRef = useRef(initialScrollState?.scrollTop ?? 0);

    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const onScroll = () => {
        if (container.clientHeight > 0)
          lastScrollTopRef.current = container.scrollTop;
      };
      container.addEventListener("scroll", onScroll, { passive: true });
      return () => container.removeEventListener("scroll", onScroll);
    }, []);

    // Restore scroll position when a keep-alive channel transitions from hidden to visible.
    // display:none may reset scrollTop to 0; lastScrollTopRef was captured while visible.
    const prevActiveRef = useRef(isActive);
    useLayoutEffect(() => {
      if (isActive && !prevActiveRef.current) {
        const container = messagesContainerRef.current;
        if (container && lastScrollTopRef.current > 0) {
          container.scrollTop = lastScrollTopRef.current;
        }
      }
      prevActiveRef.current = isActive;
    }, [isActive]);

    useImperativeHandle(ref, () => ({
      setAtBottom: () => {
        wasAtBottomRef.current = true;
      },
      scrollToBottom,
      getScrollState: () => ({
        scrollTop: lastScrollTopRef.current,
        isAtBottom: wasAtBottomRef.current,
        visibleCount: visibleMessageCountRef.current,
      }),
    }));

    useEffect(() => {
      isScrolledUpRef.current = isScrolledUp;
      // When the user returns to the bottom, shrink the window back to the base so
      // slice(-N) resumes trimming old messages from the top (memory optimization).
      // Only shrink if we grew above the base — preserves a sub-default saved visibleCount.
      if (!isScrolledUp && !isDetachedRef.current) {
        setVisibleMessageCount((prev) =>
          prev > DEFAULT_VISIBLE_MESSAGE_COUNT
            ? DEFAULT_VISIBLE_MESSAGE_COUNT
            : prev,
        );
      }
    }, [isScrolledUp]);

    // Reset ref-tracked windowing state when switching channels.
    // visibleMessageCount is NOT reset here — useState(initialScrollState?.visibleCount ?? DEFAULT_VISIBLE_MESSAGE_COUNT)
    // already initializes it correctly on mount, and this effect runs once on mount for the
    // same channelKey (each instance is bound to exactly one channel by the parent key={}).
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional full reset on channel change
    useEffect(() => {
      prevFilteredLengthRef.current = 0;
      prevFirstMsgIdRef.current = null;
      prevScrollHeightRef.current = 0;
      pendingPrependRef.current = false;
      resizeObserverPrevSHRef.current = 0;
    }, [channelKey]);

    const rowTop = (id: string): number | null => {
      const container = messagesContainerRef.current;
      const row = container && findMessageRow(container, id);
      return container && row
        ? row.getBoundingClientRect().top -
            container.getBoundingClientRect().top
        : null;
    };

    // We grow the window during render: grown one commit later, slice(-N)
    // would drop the top rows for a commit and remount them all.
    const [trackedList, setTrackedList] = useState({
      messages: channelMessages,
      jumpId: windowJumpId,
    });
    if (
      trackedList.messages !== channelMessages ||
      trackedList.jumpId !== windowJumpId
    ) {
      setTrackedList({ messages: channelMessages, jumpId: windowJumpId });
      const previous = trackedList.messages;
      const delta = channelMessages.length - previous.length;
      const isFirstChanged = channelMessages[0]?.id !== previous[0]?.id;
      const isSameWindow = trackedList.jumpId === windowJumpId;
      // The DOM still shows the dropped rows during this render, so we measure
      // here. The first kept row gains a date header, so we anchor on the next.
      const anchorId = channelMessages[1]?.id;
      if (
        isSameWindow &&
        isDetached &&
        delta < 0 &&
        isFirstChanged &&
        anchorId
      ) {
        const top = rowTop(anchorId);
        if (top !== null) droppedRowsAnchorRef.current = { id: anchorId, top };
      }
      if (
        isSameWindow &&
        previous.length > 0 &&
        delta > 0 &&
        (isFirstChanged || isScrolledUp || isDetached)
      )
        setVisibleMessageCount((prev) => prev + delta);
    }

    const displayedMessages = useMemo(
      () => channelMessages.slice(-visibleMessageCount),
      [channelMessages, visibleMessageCount],
    );
    const { isHoldingRef, isHoldingJump, releaseJump, keepHeldRowInPlace } =
      useMessageJump({
        containerRef: messagesContainerRef,
        serverId,
        isActive,
        channelMessages,
        displayedMessages,
        visibleMessageCount,
        setVisibleMessageCount,
        windowJumpId,
        wasAtBottomRef,
      });

    const locallyHidden = channelMessages.length > displayedMessages.length;
    const serverHasMore =
      (channel?.hasMoreHistory ?? privateChat?.hasMoreHistory) === true;
    const hasMoreMessages = locallyHidden || serverHasMore;
    const isHistoryLocalOnly = useStore(
      (state) => !serverSupportsChathistory(state, serverId),
    );

    const eventGroups = useMemo(
      () => groupConsecutiveEvents(displayedMessages),
      [displayedMessages],
    );

    const isLoadingHistory =
      (channel?.isLoadingHistory ?? privateChat?.isLoadingHistory) === true;

    // Scroll to bottom on initial mount, unless a saved position was passed in.
    // A jump can mount the list, and its layout effect has already placed the row.
    // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount only
    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      if (isHoldingRef.current) {
        wasAtBottomRef.current = false;
        lastScrollTopRef.current = container.scrollTop;
      } else if (initialScrollState) {
        container.scrollTop = initialScrollState.scrollTop;
        lastScrollTopRef.current = initialScrollState.scrollTop;
        wasAtBottomRef.current = false;
      } else {
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollHeight;
        wasAtBottomRef.current = true;
      }
    }, []);

    // Scroll to bottom after initial join history loads; clear fetch spinner at batch end.
    const wasLoadingHistoryRef = useRef(false);
    // biome-ignore lint/correctness/useExhaustiveDependencies: scrollToBottom is stable via useCallback; refs and setters are stable
    useLayoutEffect(() => {
      if (wasLoadingHistoryRef.current && !isLoadingHistory) {
        if (isFetchingMoreRef.current) {
          // delta correction for scroll position is handled by useLayoutEffect([displayedMessages])
          isFetchingMoreRef.current = false;
          setIsFetchingMore(false);
        } else if (!isDetachedRef.current && !isHoldingRef.current) {
          scrollToBottom();
          wasAtBottomRef.current = true;
        }
      }
      wasLoadingHistoryRef.current = isLoadingHistory;
    }, [isLoadingHistory]);

    const resetWindowTracking = () => {
      prevFilteredLengthRef.current = channelMessages.length;
      prevFirstMsgIdRef.current = channelMessages[0]?.id ?? null;
      pendingPrependRef.current = false;
    };

    // We treat a jump's swap of every message as a new list, so we skip the prepend correction.
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a jump replaces the window; refs are stable
    useLayoutEffect(() => {
      if (windowJumpId === undefined) return;
      resetWindowTracking();
    }, [windowJumpId]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chat returns to the present; refs and setters are stable
    useLayoutEffect(() => {
      const wasDetached = wasDetachedRef.current;
      wasDetachedRef.current = isDetached;
      if (isDetached || !wasDetached) return;
      releaseJump();
      resetWindowTracking();
      setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
      wasAtBottomRef.current = true;
      scrollToBottom();
    }, [isDetached]);

    useLayoutEffect(() => {
      const newLength = channelMessages.length;
      const newFirstId = channelMessages[0]?.id ?? null;
      const delta = newLength - prevFilteredLengthRef.current;
      if (
        prevFilteredLengthRef.current > 0 &&
        delta > 0 &&
        newFirstId !== prevFirstMsgIdRef.current
      )
        pendingPrependRef.current = true;

      prevFilteredLengthRef.current = newLength;
      prevFirstMsgIdRef.current = newFirstId;
    }, [channelMessages]);

    // Compensate scrollTop when content is prepended above the viewport.
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every displayedMessages render to capture the resulting scrollHeight; refs are stable
    useLayoutEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;

      // Skip while container is display:none — scrollHeight collapses to 0 and would
      // poison prevScrollHeightRef, causing a huge spurious delta on the next visible render.
      if (container.clientHeight === 0) return;

      const prevHeight = prevScrollHeightRef.current;
      const newHeight = container.scrollHeight;

      const wasPrepend = pendingPrependRef.current;
      // We keep the flag until the height changes, since a render can commit the
      // prepend before the new rows have any height.
      if (wasPrepend && newHeight !== prevHeight) {
        pendingPrependRef.current = false;
      }

      if (
        isScrolledUpRef.current &&
        prevHeight > 0 &&
        newHeight > prevHeight &&
        wasPrepend
      ) {
        const delta = newHeight - prevHeight;
        container.scrollTop += delta;
        resizeObserverPrevSHRef.current = newHeight;
      }

      const anchor = droppedRowsAnchorRef.current;
      droppedRowsAnchorRef.current = null;
      const anchorTop = anchor && rowTop(anchor.id);
      if (anchor && anchorTop != null) {
        container.scrollTop += anchorTop - anchor.top;
        resizeObserverPrevSHRef.current = newHeight;
      }

      prevScrollHeightRef.current = newHeight;
    }, [displayedMessages]);

    // Re-stick to bottom when inner message content grows (media/audio previews loading).
    // Uses prevScrollHeight instead of wasAtBottomRef to avoid stale-flag race where the
    // ref is true while the user is actively scrolling up.
    // When the container width changes (member list toggle, window resize), text reflows
    // and scrollHeight changes; preserve proportional scroll position for scrolled-up users.
    // biome-ignore lint/correctness/useExhaustiveDependencies: scrollToBottom is a stable ref
    useEffect(() => {
      const container = messagesContainerRef.current;
      const inner = messagesInnerRef.current;
      if (!inner || !container) return;
      resizeObserverPrevSHRef.current = container.scrollHeight;
      let prevClientWidth = container.clientWidth;
      const observer = new ResizeObserver(() => {
        if (container.clientHeight === 0) return;
        // Effect may re-initialize while container is display:none (ref=0).
        // Re-seed with current dimensions and skip — no reliable "was at bottom" data.
        if (resizeObserverPrevSHRef.current === 0) {
          resizeObserverPrevSHRef.current = container.scrollHeight;
          prevClientWidth = container.clientWidth;
          return;
        }
        const currentClientWidth = container.clientWidth;
        const widthChanged = currentClientWidth !== prevClientWidth;
        prevClientWidth = currentClientWidth;
        const prevSH = resizeObserverPrevSHRef.current;
        const wasAtPrevBottom =
          container.scrollTop + container.clientHeight >=
          prevSH - SCROLL_TOLERANCE;
        resizeObserverPrevSHRef.current = container.scrollHeight;
        if (isHoldingRef.current) {
          keepHeldRowInPlace();
        } else if (wasAtPrevBottom && !isDetachedRef.current) {
          scrollToBottom();
        } else if (widthChanged && prevSH > 0) {
          const ratio = container.scrollTop / prevSH;
          container.scrollTop = Math.round(ratio * container.scrollHeight);
        }
      });
      observer.observe(inner);
      return () => observer.disconnect();
    }, [isLoadingHistory, channelId, privateChatId]);

    // The keyboard resizes the list without scrolling it: we keep the bottom in
    // view, and we pull back a scroll WebKit leaves past the end once it grows.
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs and scrollToBottom are stable
    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      let frame = 0;
      const keepPlace = () => {
        if (container.clientHeight === 0) return;
        if (isHoldingRef.current) {
          keepHeldRowInPlace();
          return;
        }
        if (wasAtBottomRef.current && !isDetachedRef.current) {
          scrollToBottom();
          return;
        }
        const end = container.scrollHeight - container.clientHeight;
        if (container.scrollTop > end) container.scrollTop = end;
      };
      let height = container.clientHeight;
      const observer = new ResizeObserver(() => {
        if (container.clientHeight === height) return;
        height = container.clientHeight;
        keepPlace();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(keepPlace);
      });
      observer.observe(container);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
    }, []);

    const [isLoadingNewer, setIsLoadingNewer] = useState(false);
    // biome-ignore lint/correctness/useExhaustiveDependencies: channelMessages reruns it after each page in case the bottom is still in view
    useEffect(() => {
      if (!isDetached || isScrolledUp || isHoldingRef.current) return;
      if (!isActive || isLoadingNewer || !historyTarget) return;
      setIsLoadingNewer(true);
      loadNewerMessages(useStore, serverId, historyTarget).finally(() =>
        setIsLoadingNewer(false),
      );
    }, [
      isDetached,
      isScrolledUp,
      isHoldingJump,
      isActive,
      isLoadingNewer,
      channelMessages,
    ]);

    // Auto-scroll on new messages — skip when this channel is hidden (display:none).
    // biome-ignore lint/correctness/useExhaustiveDependencies: only scroll when messages change, not when isActive changes
    useEffect(() => {
      if (!isActive || isDetachedRef.current || isHoldingRef.current) return;
      const isNarrowView = window.matchMedia("(max-width: 768px)").matches;
      const isChatVisible =
        !isNarrowView || mobileViewActiveColumn === "chatView";
      if (wasAtBottomRef.current && isChatVisible) {
        scrollToBottom();
      }
    }, [displayedMessages, mobileViewActiveColumn, scrollToBottom, isActive]);

    return (
      <>
        <div
          ref={messagesContainerRef}
          className="flex-grow overflow-y-auto overflow-x-hidden flex flex-col bg-discord-dark-200 text-discord-text-normal relative"
          // Disable CSS scroll anchoring — it compounds with our useLayoutEffect delta correction causing double-jumps in browser.
          style={{ overflowAnchor: "none" }}
          onCopy={(e) => {
            const root = messagesContainerRef.current;
            if (!root) return;
            const markdown = buildMarkdownFromSelection(
              window.getSelection(),
              root,
            );
            if (markdown !== null) {
              e.preventDefault();
              e.clipboardData.setData("text/plain", markdown);
            }
          }}
        >
          {isLoadingHistory &&
          !isFetchingMore &&
          channelMessages.length === 0 ? (
            <div className="flex-grow flex items-center justify-center">
              <LoadingSpinner
                size="lg"
                text="Loading chat history..."
                className="text-discord-text-muted"
              />
            </div>
          ) : (
            <div ref={messagesInnerRef} className="flex flex-col">
              {hasMoreMessages && (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="hairline flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      if (locallyHidden) {
                        pendingPrependRef.current = true;
                        setVisibleMessageCount(
                          (prev) => prev + DEFAULT_VISIBLE_MESSAGE_COUNT,
                        );
                      } else if (serverHasMore && historyTarget) {
                        const oldest = channelMessages[0];
                        isFetchingMoreRef.current = true;
                        setIsFetchingMore(true);
                        const stopFetching = () => {
                          isFetchingMoreRef.current = false;
                          setIsFetchingMore(false);
                        };
                        loadOlderMessages(
                          useStore,
                          serverId,
                          historyTarget,
                          oldest?.timestamp
                            ? new Date(oldest.timestamp).getTime()
                            : Date.now(),
                        )
                          .then((isPageComing) => {
                            if (!isPageComing) stopFetching();
                          })
                          .catch(stopFetching);
                      }
                    }}
                    disabled={isFetchingMore}
                    title={
                      isHistoryLocalOnly
                        ? t`Load earlier messages saved on this device`
                        : undefined
                    }
                    className={`chip-action ${isTouch ? "min-h-10 px-4" : ""}`}
                  >
                    {isFetchingMore ? (
                      <LoadingSpinner
                        size="sm"
                        text=""
                        className="text-discord-text-muted"
                      />
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-3 h-3"
                        aria-hidden="true"
                      >
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    )}
                    {isFetchingMore
                      ? t`Getting more messages...`
                      : locallyHidden
                        ? t`${channelMessages.length - displayedMessages.length} older messages`
                        : t`Load older messages`}
                  </button>
                  <span className="hairline flex-1" />
                </div>
              )}
              {eventGroups.map((group) => {
                if (group.type === "eventGroup") {
                  const firstId = group.messages[0]?.id || "";
                  const lastId =
                    group.messages[group.messages.length - 1]?.id || "";
                  const groupKey = `group-${firstId}-${lastId}`;
                  return (
                    <CollapsedEventMessage
                      key={groupKey}
                      eventGroup={group}
                      users={channel?.users || []}
                      onUsernameContextMenu={onUsernameContextMenu}
                    />
                  );
                }
                const message = group.messages[0];
                const originalIndex = channelMessages.findIndex(
                  (m) => m.id === message.id,
                );
                const previousMessage = channelMessages[originalIndex - 1];
                const showHeader = shouldShowMessageHeader(
                  previousMessage,
                  message,
                );
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    showDate={
                      originalIndex === 0 ||
                      new Date(message.timestamp).toDateString() !==
                        new Date(
                          channelMessages[originalIndex - 1]?.timestamp,
                        ).toDateString()
                    }
                    showHeader={showHeader}
                    setReplyTo={onReply}
                    isHighlighted={message.id === highlightedMessageId}
                    isSearchHit={message.id === searchHitMessageId}
                    onUsernameContextMenu={onUsernameContextMenu}
                    onIrcLinkClick={onIrcLinkClick}
                    onReactClick={onReactClick}
                    joinChannel={joinChannel}
                    onReactionUnreact={onReactionUnreact}
                    onOpenReactionModal={onOpenReactionModal}
                    onDirectReaction={onDirectReaction}
                    serverId={serverId}
                    channelId={channelId || undefined}
                    privateChatId={privateChatId || undefined}
                    onRedactMessage={onRedactMessage}
                    onOpenProfile={onOpenProfile}
                  />
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} className="h-px" />
        </div>
        <ScrollToBottomButton
          isVisible={isScrolledUp && !isDetached}
          onClick={() => {
            releaseJump();
            scrollToBottom();
          }}
        />
        {isDetached && historyTarget && (
          <div className="flex justify-center px-4 py-2 bg-discord-dark-200">
            <button
              type="button"
              onClick={() => showPresent(useStore, serverId, historyTarget)}
              onMouseDown={(e) => e.preventDefault()}
              className={`chip-action ${isTouch ? "min-h-11 px-4 text-sm" : ""}`}
            >
              <FaArrowDown className="w-3 h-3" aria-hidden="true" />
              {t`Jump to present`}
            </button>
          </div>
        )}
      </>
    );
  },
);

ChannelMessageList.displayName = "ChannelMessageList";

// Wrap with memo so hidden keep-alive channels skip re-renders when their props
// haven't changed (e.g. when messageText changes in the input — the only thing
// that changes on typing is local state inside ChatArea, not the props we pass here).
export const MemoChannelMessageList = memo(ChannelMessageList);
