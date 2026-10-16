import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import {
  Fragment,
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
import { useMessageJump } from "../../hooks/useMessageJump";
import {
  isScrolledToBottom,
  SCROLL_TOLERANCE,
  useScrollToBottom,
} from "../../hooks/useScrollToBottom";
import { buildMarkdownFromSelection } from "../../lib/chatMarkdownCopy";
import { groupConsecutiveEvents } from "../../lib/eventGrouping";
import { findMessageRow } from "../../lib/highlightRow";
import ircClient from "../../lib/ircClient";
import { shouldShowMessageHeader } from "../../lib/messageGrouping";
import useStore from "../../store";
import {
  loadNewerMessages,
  loadOlderMessages,
  showMessagesFromReadMarker,
  showPresent,
  showSavedHistory,
} from "../../store/handlers/history";
import {
  firstUnreadMessageId,
  isChatMessage,
  isOwnMessage,
  messageTime,
  serverTracksReadMarker,
} from "../../store/helpers";
import type { Message as MessageType } from "../../types";
import { CollapsedEventMessage } from "../message/CollapsedEventMessage";
import { MessageItem } from "../message/MessageItem";
import { ScrollToBottomButton } from "../ui/ScrollToBottomButton";
import { MessageSkeletons } from "../ui/SkeletonRow";

export const DEFAULT_VISIBLE_MESSAGE_COUNT = 100;
// How close to either end of the list we start loading the next page.
const LOAD_AHEAD_PX = 800;
// How long we wait for an older page before letting scrolling ask again.
const OLDER_PAGE_TIMEOUT_MS = 10_000;
// How long a chat may stay behind placeholders while it finds its unread line.
const UNREAD_POSITIONING_LIMIT_MS = 4000;
// How long a chat waits for its read marker before opening at the bottom.
const READ_MARKER_WAIT_MS = 3000;
// The room left above the "New messages" line when a chat opens on it.
const UNREAD_LINE_MARGIN_PX = 48;
// How long the "New messages" line stays once everything under it is read.
const READ_LINE_LINGER_MS = 4000;
// The read messages we show above the "New messages" line.
const UNREAD_CONTEXT_ROWS = 20;

type Opening =
  | { step: "marker" }
  | {
      step: "placing" | "loading" | "open";
      after: number | null;
      hasFetched: boolean;
      isOverdue?: boolean;
    };

// Stable empty array — prevents selector from returning a new [] on every render
// when the channel has no messages yet (undefined ?? [] would create a new ref each time).
const EMPTY_MESSAGES: import("../../types").Message[] = [];

export interface ChannelMessageListHandle {
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
    const [visibleMessageCount, setVisibleMessageCount] = useState(
      initialScrollState?.visibleCount ?? DEFAULT_VISIBLE_MESSAGE_COUNT,
    );
    // Ref mirror so getScrollState closure always reads the current value without needing it as a dep.
    const visibleMessageCountRef = useRef(visibleMessageCount);
    visibleMessageCountRef.current = visibleMessageCount;
    // Distinguishes initial join (full-screen spinner) from subsequent "load more" (button spinner).
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const isFetchingMoreRef = useRef(false);
    const oldestAtFetchRef = useRef<string | null>(null);
    // We remember the oldest row when an older page added nothing, so we ask
    // the server for each older page once.
    const emptyOlderPageAtRef = useRef<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesInnerRef = useRef<HTMLDivElement>(null);
    // prev scrollHeight for prepend delta-correction.
    const prevScrollHeightRef = useRef(0);
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
      scrollToBottom: () => {
        wasAtBottomRef.current = true;
        scrollToBottom();
      },
      getScrollState: () => ({
        scrollTop: lastScrollTopRef.current,
        isAtBottom: wasAtBottomRef.current,
        visibleCount: visibleMessageCountRef.current,
      }),
    }));

    useEffect(() => {
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

    const [trackedList, setTrackedList] = useState({
      messages: channelMessages,
      jumpId: windowJumpId,
    });
    const displayedMessages = useMemo(
      () => channelMessages.slice(-visibleMessageCount),
      [channelMessages, visibleMessageCount],
    );
    const {
      isHoldingRef,
      isHoldingJump,
      holdRow,
      releaseJump,
      keepHeldRowInPlace,
    } = useMessageJump({
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

    // We grow the window during render: grown one commit later, slice(-N)
    // would drop the top rows for a commit and remount them all.
    if (
      trackedList.messages !== channelMessages ||
      trackedList.jumpId !== windowJumpId
    ) {
      setTrackedList({ messages: channelMessages, jumpId: windowJumpId });
      const previous = trackedList.messages;
      const delta = channelMessages.length - previous.length;
      const isFirstChanged = channelMessages[0]?.id !== previous[0]?.id;
      const isSameWindow = trackedList.jumpId === windowJumpId;
      // A window that joins the present keeps its top row, so it is still the same list.
      const isSameList = isSameWindow || !isFirstChanged;
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
        isSameList &&
        previous.length > 0 &&
        delta > 0 &&
        (isFirstChanged || isScrolledUp || isDetached || isHoldingRef.current)
      )
        setVisibleMessageCount((prev) => prev + delta);
    }

    const locallyHidden = channelMessages.length > displayedMessages.length;
    const serverHasMore =
      (channel?.hasMoreHistory ?? privateChat?.hasMoreHistory) === true;
    const hasMoreMessages = locallyHidden || serverHasMore;

    const eventGroups = useMemo(
      () => groupConsecutiveEvents(displayedMessages),
      [displayedMessages],
    );

    const isLoadingHistory =
      (channel?.isLoadingHistory ?? privateChat?.isLoadingHistory) === true;

    const readMarker = channel ? channel.readMarker : privateChat?.readMarker;
    const isServerConnected =
      servers.find((s) => s.id === serverId)?.isConnected === true;
    const isAppFocused = useStore((state) => state.ui.isAppFocused !== false);
    const isAppFocusedRef = useRef(isAppFocused);
    isAppFocusedRef.current = isAppFocused;
    // While the user is away we follow new messages only until the "New
    // messages" line reaches the top, so nothing unseen scrolls out of view.
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs and scrollToBottom are stable
    const followNewMessages = useCallback(() => {
      const container = messagesContainerRef.current;
      const line = container?.querySelector<HTMLElement>("[data-unread-line]");
      if (!container || isAppFocusedRef.current || !line) {
        scrollToBottom();
        return;
      }
      const lineTop =
        line.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTop = Math.min(
        container.scrollHeight - container.clientHeight,
        Math.max(0, lineTop - UNREAD_LINE_MARGIN_PX),
      );
    }, []);
    const tracksReadMarker = useStore((state) =>
      serverTracksReadMarker(state, serverId),
    );
    // We keep the marker as it stood on arrival, so the "New messages" line
    // stays put while the chat is read.
    const [opening, setOpening] = useState<Opening>({ step: "marker" });
    const [wasActive, setWasActive] = useState(isActive);
    if (wasActive !== isActive) {
      setWasActive(isActive);
      if (isActive) setOpening({ step: "marker" });
    }
    // A server without read markers keeps no shared place, so its chats open
    // at the bottom.
    if (isActive && opening.step === "marker" && readMarker !== undefined)
      setOpening(
        tracksReadMarker
          ? {
              step: "placing",
              after: readMarker
                ? Date.parse(readMarker)
                : Number.NEGATIVE_INFINITY,
              hasFetched: false,
            }
          : { step: "open", after: null, hasFetched: false },
      );
    const unreadAfter = opening.step === "marker" ? null : opening.after;
    const isOverdue = opening.step !== "marker" && opening.isOverdue === true;

    const firstUnreadId = useMemo(
      () =>
        unreadAfter == null
          ? undefined
          : firstUnreadMessageId(
              channelMessages,
              unreadAfter,
              ircClient.getNick(serverId),
            ),
      [channelMessages, unreadAfter, serverId],
    );
    const oldestLoaded = channelMessages[0];
    const needsMarkerPage =
      opening.step === "placing" &&
      !opening.hasFetched &&
      unreadAfter != null &&
      Number.isFinite(unreadAfter) &&
      !isDetached &&
      hasMoreMessages &&
      (!oldestLoaded || messageTime(oldestLoaded) > unreadAfter);
    const isPositioningOnUnread =
      isActive &&
      (opening.step === "placing" || opening.step === "loading") &&
      unreadAfter != null;

    const isAwayFromPresent =
      isScrolledUp || isDetached || isPositioningOnUnread;
    // Messages that land while the user watches the bottom are read as they
    // arrive, so they never start a new line. We also clear the line when the
    // user sends a message, since sending means they have read the chat.
    const [watchedMessages, setWatchedMessages] = useState(channelMessages);
    if (watchedMessages !== channelMessages) {
      setWatchedMessages(channelMessages);
      const newest = channelMessages.at(-1);
      const ownNick = ircClient.getNick(serverId);
      const hasJustSent =
        !!newest &&
        newest.id !== watchedMessages.at(-1)?.id &&
        isChatMessage(newest) &&
        isOwnMessage(newest, ownNick);
      if (
        isActive &&
        opening.step === "open" &&
        opening.after != null &&
        newest &&
        (hasJustSent ||
          (!isAwayFromPresent &&
            isAppFocused &&
            !firstUnreadMessageId(watchedMessages, opening.after, ownNick)))
      )
        setOpening({
          ...opening,
          after: Math.max(opening.after, messageTime(newest)),
        });
    }
    useEffect(() => {
      if (!isActive) return;
      useStore.setState((state) =>
        state.ui.isChatAwayFromPresent === isAwayFromPresent
          ? {}
          : { ui: { ...state.ui, isChatAwayFromPresent: isAwayFromPresent } },
      );
    }, [isActive, isAwayFromPresent]);

    // Once the user has read past the line at the bottom, we keep it a moment
    // so a glance still shows where the new messages began, then drop it.
    const readUpTo = readMarker ? Date.parse(readMarker) : null;
    useEffect(() => {
      if (!isActive || opening.step !== "open" || isAwayFromPresent) return;
      if (!isAppFocused) return;
      if (readUpTo == null || unreadAfter == null || readUpTo <= unreadAfter)
        return;
      const timer = setTimeout(
        () =>
          setOpening((o) =>
            o.step === "open" ? { ...o, after: readUpTo } : o,
          ),
        READ_LINE_LINGER_MS,
      );
      return () => clearTimeout(timer);
    }, [
      isActive,
      opening.step,
      isAwayFromPresent,
      isAppFocused,
      readUpTo,
      unreadAfter,
    ]);

    // A chat restored at startup opens before we have logged in, so we wait
    // for its marker while the server could still send one.
    useEffect(() => {
      if (!isActive || opening.step !== "marker" || !isServerConnected) return;
      const timer = setTimeout(
        () => setOpening({ step: "open", after: null, hasFetched: false }),
        READ_MARKER_WAIT_MS,
      );
      return () => clearTimeout(timer);
    }, [isActive, opening.step, isServerConnected]);

    // Late history can hold the chat back, so after a while we place the
    // unread line with the rows that have arrived and keep unseen ones unread.
    useEffect(() => {
      if (!isActive || opening.step !== "placing" || isOverdue) return;
      const timer = setTimeout(
        () =>
          setOpening((o) =>
            o.step === "placing" ? { ...o, isOverdue: true } : o,
          ),
        UNREAD_POSITIONING_LIMIT_MS,
      );
      return () => clearTimeout(timer);
    }, [isActive, opening.step, isOverdue]);

    // We ask once per opening, also when React runs the effect twice, and drop
    // the page if the user has moved on before it arrives.
    const markerPageRequestRef = useRef<Opening | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: the marker, the loaded rows and loading decide when to ask
    useEffect(() => {
      if (!needsMarkerPage || !historyTarget) return;
      if (opening.step !== "placing" || opening.after == null) return;
      if (isLoadingHistory && !isOverdue) return;
      if (markerPageRequestRef.current === opening) return;
      const request = opening;
      markerPageRequestRef.current = request;
      setOpening({ ...opening, step: "loading", hasFetched: true });
      showMessagesFromReadMarker(
        useStore,
        serverId,
        historyTarget,
        opening.after,
        () => markerPageRequestRef.current === request,
      ).finally(() =>
        setOpening((o) =>
          o.step === "loading" ? { ...o, step: "placing" } : o,
        ),
      );
    }, [needsMarkerPage, isLoadingHistory, isOverdue]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable; the list and the opening step decide when to look
    useLayoutEffect(() => {
      if (!isActive || opening.step !== "placing") return;
      if ((isLoadingHistory && !isOverdue) || needsMarkerPage) return;
      const container = messagesContainerRef.current;
      if (!container) return;
      const index = channelMessages.findIndex((m) => m.id === firstUnreadId);
      if (index >= 0 && channelMessages.length - index > visibleMessageCount) {
        setVisibleMessageCount(
          channelMessages.length - index + UNREAD_CONTEXT_ROWS,
        );
        return;
      }
      setOpening({ ...opening, step: "open" });
      const line = container.querySelector<HTMLElement>("[data-unread-line]");
      if (!line) return;
      const top =
        line.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      if (top >= container.scrollHeight - container.clientHeight) return;
      container.scrollTop = Math.max(0, top - UNREAD_LINE_MARGIN_PX);
      resizeObserverPrevSHRef.current = container.scrollHeight;
      holdRow(line);
      // The bottom detection can still deliver what it saw before we moved,
      // so we have it look again once those reports are out.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          container.dispatchEvent(new Event("scroll")),
        ),
      );
    }, [
      displayedMessages,
      opening,
      isActive,
      isLoadingHistory,
      needsMarkerPage,
    ]);

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
          if (channelMessages[0]?.id === oldestAtFetchRef.current)
            emptyOlderPageAtRef.current = oldestAtFetchRef.current;
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
      const hasJoinedPresent =
        channelMessages[0]?.id === prevFirstMsgIdRef.current;
      resetWindowTracking();
      if (hasJoinedPresent && isHoldingRef.current) return;
      releaseJump();
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

      // We read the position here because the scrolled-up state updates a
      // render late, after the first scroll that loads a page.
      const wasAboveBottom =
        container.scrollTop + container.clientHeight <
        prevHeight - SCROLL_TOLERANCE;
      if (
        wasAboveBottom &&
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
          followNewMessages();
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
    const isLoadingNewerRef = useRef(false);

    const loadOlder = (): boolean => {
      if (!isActive || isLoadingHistory || isFetchingMoreRef.current)
        return false;
      const oldest = channelMessages[0];
      if (locallyHidden) {
        pendingPrependRef.current = true;
        setVisibleMessageCount((prev) => prev + DEFAULT_VISIBLE_MESSAGE_COUNT);
        return true;
      }
      if (!serverHasMore || !historyTarget) return false;
      if (oldest && emptyOlderPageAtRef.current === oldest.id) return false;
      isFetchingMoreRef.current = true;
      oldestAtFetchRef.current = oldest?.id ?? null;
      setIsFetchingMore(true);
      const stopFetching = () => {
        isFetchingMoreRef.current = false;
        setIsFetchingMore(false);
      };
      // A page read from disk can start and end loading within one render,
      // which the loading watcher never sees, so we also stop after a while.
      setTimeout(() => {
        if (oldestAtFetchRef.current === (oldest?.id ?? null)) stopFetching();
      }, OLDER_PAGE_TIMEOUT_MS);
      loadOlderMessages(
        useStore,
        serverId,
        historyTarget,
        oldest?.timestamp ? new Date(oldest.timestamp).getTime() : Date.now(),
      )
        .then((isPageComing) => {
          if (!isPageComing) stopFetching();
        })
        .catch(stopFetching);
      return true;
    };

    useEffect(() => {
      if (!isFetchingMoreRef.current) return;
      if (channelMessages[0]?.id === oldestAtFetchRef.current) return;
      oldestAtFetchRef.current = null;
      isFetchingMoreRef.current = false;
      setIsFetchingMore(false);
    }, [channelMessages]);

    const loadNewer = () => {
      if (!isDetached || !isActive || !historyTarget) return;
      if (isLoadingNewerRef.current) return;
      isLoadingNewerRef.current = true;
      setIsLoadingNewer(true);
      loadNewerMessages(useStore, serverId, historyTarget).finally(() => {
        isLoadingNewerRef.current = false;
        setIsLoadingNewer(false);
      });
    };

    const loadNearEdgesRef = useRef(() => {});
    loadNearEdgesRef.current = () => {
      const container = messagesContainerRef.current;
      if (!container || container.clientHeight === 0) return;
      // Rows added below never move the held row, so we load newer ones while holding.
      if (isScrolledToBottom(container, LOAD_AHEAD_PX)) loadNewer();
      if (isHoldingRef.current) return;
      if (
        container.scrollTop < LOAD_AHEAD_PX &&
        (!isScrolledToBottom(container) ||
          container.scrollHeight <= container.clientHeight)
      )
        loadOlder();
    };

    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const onScroll = () => loadNearEdgesRef.current();
      container.addEventListener("scroll", onScroll, { passive: true });
      return () => container.removeEventListener("scroll", onScroll);
    }, []);

    // A page can land with the edge still in view, which fires no scroll event.
    // biome-ignore lint/correctness/useExhaustiveDependencies: each listed change can leave an edge in view
    useEffect(() => {
      loadNearEdgesRef.current();
    }, [
      displayedMessages,
      isLoadingHistory,
      hasMoreMessages,
      isFetchingMore,
      isLoadingNewer,
      isActive,
      isHoldingJump,
    ]);

    // Auto-scroll on new messages — skip when this channel is hidden (display:none).
    // biome-ignore lint/correctness/useExhaustiveDependencies: only scroll when messages change, not when isActive changes
    useEffect(() => {
      if (!isActive || isDetachedRef.current || isHoldingRef.current) return;
      const isNarrowView = window.matchMedia("(max-width: 768px)").matches;
      const isChatVisible =
        !isNarrowView || mobileViewActiveColumn === "chatView";
      if (wasAtBottomRef.current && isChatVisible) followNewMessages();
    }, [displayedMessages, mobileViewActiveColumn, isActive]);

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
          {isPositioningOnUnread && (
            <div className="sticky top-0 z-20 h-0">
              <div className="h-screen flex flex-col bg-discord-dark-200">
                <MessageSkeletons isFilling />
              </div>
            </div>
          )}
          {isLoadingHistory &&
          !isFetchingMore &&
          channelMessages.length === 0 ? (
            <MessageSkeletons isFilling />
          ) : (
            <div ref={messagesInnerRef} className="flex-grow flex flex-col">
              {hasMoreMessages && <MessageSkeletons isFilling />}
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
                  <Fragment key={message.id}>
                    {message.id === firstUnreadId && (
                      // We draw the line over the boundary with no height of its own, so the messages stay put when it comes and goes.
                      // Above the first row there is nothing to overlap, so there it takes its own height.
                      <div
                        data-unread-line
                        className={`relative z-[5] pointer-events-none ${originalIndex === 0 ? "h-5" : "h-0"}`}
                      >
                        <div
                          className={`absolute inset-x-4 -translate-y-1/2 flex items-center gap-2 text-xs font-semibold text-discord-red ${originalIndex === 0 ? "top-1/2" : "top-0"}`}
                        >
                          <span className="hairline flex-1 bg-discord-red/70" />
                          <span className="px-1 rounded bg-discord-dark-200">
                            <Trans>New messages</Trans>
                          </span>
                        </div>
                      </div>
                    )}
                    <MessageItem
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
                  </Fragment>
                );
              })}
              {isDetached && <MessageSkeletons />}
            </div>
          )}
          <div ref={messagesEndRef} className="h-px" />
        </div>
        <ScrollToBottomButton
          isVisible={isScrolledUp || isDetached}
          onClick={() => {
            releaseJump();
            markerPageRequestRef.current = null;
            setOpening((o) =>
              o.step === "placing" || o.step === "loading"
                ? { ...o, step: "open" }
                : o,
            );
            if (isDetached && historyTarget)
              showPresent(useStore, serverId, historyTarget);
            else scrollToBottom();
          }}
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
