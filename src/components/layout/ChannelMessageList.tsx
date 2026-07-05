import { plural } from "@lingui/core/macro";
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
import {
  SCROLL_TOLERANCE,
  useScrollToBottom,
} from "../../hooks/useScrollToBottom";
import { buildMarkdownFromSelection } from "../../lib/chatMarkdownCopy";
import { groupConsecutiveEvents } from "../../lib/eventGrouping";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
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
  searchQuery: string;
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
  onClearSearch: () => void;
  highlightedMessageId?: string;
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
      searchQuery,
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
      onClearSearch,
      highlightedMessageId,
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
    // Set by the window-growth layoutEffect (or button handler) when a true prepend is detected.
    // Consumed by the delta-correction layoutEffect one render later (after visibleCount grows).
    // Using a flag instead of tracking displayedMessages[0]?.id because slice(-N) slides the
    // window on every bottom append, changing displayedMessages[0] even for non-prepend renders.
    const pendingPrependRef = useRef(false);
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

    const filteredMessages = useMemo(() => {
      if (!searchQuery.trim()) return channelMessages;
      const query = searchQuery.toLowerCase();
      return channelMessages.filter(
        (msg) =>
          msg.content.toLowerCase().includes(query) ||
          msg.userId.toLowerCase().includes(query),
      );
    }, [channelMessages, searchQuery]);

    useEffect(() => {
      isScrolledUpRef.current = isScrolledUp;
      // When the user returns to the bottom, shrink the window back to the base so
      // slice(-N) resumes trimming old messages from the top (memory optimization).
      // Only shrink if we grew above the base — preserves a sub-default saved visibleCount.
      if (!isScrolledUp) {
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

    const displayedMessages = useMemo(() => {
      if (searchQuery.trim()) return filteredMessages;
      return filteredMessages.slice(-visibleMessageCount);
    }, [filteredMessages, visibleMessageCount, searchQuery]);

    const locallyHidden = filteredMessages.length > displayedMessages.length;
    const serverHasMore = channel?.hasMoreHistory === true;
    const hasMoreMessages = locallyHidden || serverHasMore;

    const eventGroups = useMemo(
      () => groupConsecutiveEvents(displayedMessages),
      [displayedMessages],
    );

    const isLoadingHistory = channel?.isLoadingHistory ?? false;

    // Scroll to bottom on initial mount, unless a saved position was passed in.
    // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount only
    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      if (initialScrollState) {
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
        } else {
          scrollToBottom();
          wasAtBottomRef.current = true;
        }
      }
      wasLoadingHistoryRef.current = isLoadingHistory;
    }, [isLoadingHistory]);

    // When older messages are prepended, grow the window so they enter displayedMessages.
    // When new messages arrive at the bottom while the user is scrolled up, also grow the
    // window to keep the current top messages visible — slice(-N) otherwise slides the
    // window forward and hides them, incrementing the "N older messages" counter on every
    // incoming message. Only let the slice trim from the top when the user is at the bottom
    // (where auto-scroll handles keeping them current).
    useLayoutEffect(() => {
      const newLength = filteredMessages.length;
      const newFirstId = filteredMessages[0]?.id ?? null;
      const delta = newLength - prevFilteredLengthRef.current;

      if (prevFilteredLengthRef.current > 0 && delta > 0) {
        if (newFirstId !== prevFirstMsgIdRef.current) {
          // Messages prepended (load-more): signal delta-correction to compensate scrollTop.
          pendingPrependRef.current = true;
          setVisibleMessageCount((prev) => prev + delta);
        } else if (isScrolledUpRef.current) {
          // Messages appended at bottom while user is scrolled up reading history.
          // Expand the window to prevent top messages from dropping out of the slice.
          setVisibleMessageCount((prev) => prev + delta);
        }
      }

      prevFilteredLengthRef.current = newLength;
      prevFirstMsgIdRef.current = newFirstId;
    }, [filteredMessages]);

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

      // Only correct when a true load-more prepend happened (flag set by the window-growth
      // layoutEffect or button handler). Bottom appends slide the slice(-N) window which also
      // changes displayedMessages[0] — ID-comparison can't distinguish the two cases.
      const wasPrepend = pendingPrependRef.current;
      // Only consume the flag when scrollHeight actually changed — the server-side load-more
      // path goes through two renders: Render A (filteredMessages grows, visibleCount unchanged,
      // same displayedMessages content, same scrollHeight) then Render B (visibleCount grows,
      // new messages enter displayedMessages, scrollHeight grows). The flag must survive Render A
      // so it's still set when Render B fires the actual correction.
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
        if (wasAtPrevBottom) {
          scrollToBottom();
        } else if (widthChanged && prevSH > 0) {
          const ratio = container.scrollTop / prevSH;
          container.scrollTop = Math.round(ratio * container.scrollHeight);
        }
      });
      observer.observe(inner);
      return () => observer.disconnect();
    }, [isLoadingHistory, channelId, privateChatId]);

    // Auto-scroll on new messages — skip when this channel is hidden (display:none).
    // biome-ignore lint/correctness/useExhaustiveDependencies: only scroll when messages change, not when isActive changes
    useEffect(() => {
      if (!isActive) return;
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
          {isLoadingHistory && !isFetchingMore ? (
            <div className="flex-grow flex items-center justify-center">
              <LoadingSpinner
                size="lg"
                text="Loading chat history..."
                className="text-discord-text-muted"
              />
            </div>
          ) : (
            <div ref={messagesInnerRef} className="flex flex-col">
              {hasMoreMessages && !searchQuery && (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (locallyHidden) {
                        pendingPrependRef.current = true;
                        setVisibleMessageCount(
                          (prev) => prev + DEFAULT_VISIBLE_MESSAGE_COUNT,
                        );
                      } else if (serverHasMore && channel && channelId) {
                        const oldest = channelMessages[0];
                        if (oldest?.timestamp) {
                          const ts = new Date(oldest.timestamp).toISOString();
                          // WebSocket responses are macrotasks; the click handler's React batch
                          // always commits before the response arrives, so flushSync is unnecessary.
                          isFetchingMoreRef.current = true;
                          setIsFetchingMore(true);
                          ircClient.requestChathistoryBefore(
                            serverId,
                            channel.name,
                            ts,
                          );
                        }
                      }
                    }}
                    disabled={isFetchingMore}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-discord-text-muted hover:text-discord-text-normal bg-discord-dark-400 hover:bg-discord-dark-300 border border-white/5 transition-all"
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
                        ? t`${filteredMessages.length - displayedMessages.length} older messages`
                        : t`Load older messages`}
                  </button>
                </div>
              )}
              {searchQuery && (
                <div className="flex justify-center items-center gap-2 py-2 bg-discord-dark-300 text-discord-text-muted text-sm">
                  <span>
                    {plural(filteredMessages.length, {
                      one: t`Found 1 message matching "${searchQuery}"`,
                      other: t`Found ${filteredMessages.length} messages matching "${searchQuery}"`,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={onClearSearch}
                    className="text-red-400 hover:text-red-300"
                    title={t`Clear search`}
                  >
                    ✕
                  </button>
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
                const showHeader =
                  !previousMessage ||
                  previousMessage.type !== "message" ||
                  previousMessage.userId !== message.userId ||
                  new Date(message.timestamp).getTime() -
                    new Date(previousMessage.timestamp).getTime() >
                    5 * 60 * 1000;
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
          isVisible={isScrolledUp}
          onClick={scrollToBottom}
        />
      </>
    );
  },
);

ChannelMessageList.displayName = "ChannelMessageList";

// Wrap with memo so hidden keep-alive channels skip re-renders when their props
// haven't changed (e.g. when messageText changes in the input — the only thing
// that changes on typing is local state inside ChatArea, not the props we pass here).
export const MemoChannelMessageList = memo(ChannelMessageList);
