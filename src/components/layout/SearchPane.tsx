import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaChevronLeft, FaTimes } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { escapeRegExp } from "../../lib/escapeRegExp";
import type { HistoryGap } from "../../lib/history/historyDb";
import { isChannelTarget } from "../../lib/ircUtils";
import {
  type JumpResult,
  jumpToMessage,
  reportJumpFailure,
} from "../../lib/jumpToMessage";
import { formatRelativeTime } from "../../lib/relativeTime";
import { serializeSearchQuery, widenScope } from "../../lib/search/searchQuery";
import { scopeLabel } from "../../lib/search/searchScope";
import type {
  SearchHit,
  SearchPage,
  SearchQuery,
} from "../../lib/search/searchTypes";
import useStore from "../../store";
import {
  fillGapsForSearch,
  searchSavedMessages,
} from "../../store/handlers/history";
import { findServerUser } from "../../store/helpers";
import type { Server } from "../../types";
import { MessageAvatar } from "../message/MessageAvatar";
import SearchQueryBar, { touchHitArea } from "../search/SearchQueryBar";
import { useSearchDraft } from "../search/useSearchDraft";
import HighlightedText, { type TextRange } from "../ui/HighlightedText";
import LoadingSpinner from "../ui/LoadingSpinner";
import SegmentedControl from "../ui/SegmentedControl";
import { SkeletonRow } from "../ui/SkeletonRow";
import { TextInput } from "../ui/TextInput";

export const SEARCH_PAGE_LIMIT = 50;

type SearchCursor = { beforeTime: number; skipAtBeforeTime?: number };

const cursorOf = (page: SearchPage): SearchCursor | undefined =>
  page.nextBeforeTime === undefined
    ? undefined
    : { beforeTime: page.nextBeforeTime, skipAtBeforeTime: page.nextSkip };
const SNIPPET_LEAD = 40;
const LOAD_MORE_MARGIN_PX = 200;

type AboutTab = "all" | "mention" | "reply";

function termPattern(text: string): RegExp | null {
  const terms = text.match(/[\p{L}\p{N}]+/gu);
  if (!terms) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegExp).join("|")})`,
    "giu",
  );
}

// We start the snippet shortly before the first match so it stays in view.
function snippetOf(text: string, pattern: RegExp | null) {
  if (!pattern) return { shown: text, ranges: [] };
  const first = text.search(pattern);
  const lead = first > SNIPPET_LEAD ? text.lastIndexOf(" ", first - 1) : -1;
  const shown = lead > 0 ? `…${text.slice(lead)}` : text;
  const ranges: TextRange[] = [...shown.matchAll(pattern)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
  return { shown, ranges };
}

function chatLabel(server: Server | undefined, target: string): string {
  const lower = target.toLowerCase();
  const channel = server?.channels.find((c) => c.name.toLowerCase() === lower);
  if (channel) return channel.name;
  if (isChannelTarget(target)) return target;
  const peer =
    server?.privateChats?.find((pc) => pc.username.toLowerCase() === lower)
      ?.username ?? target;
  return t`PM with ${peer}`;
}

// Rows without a msgid can share a time, so we number them within that time.
function hitKeys(hits: SearchHit[]): string[] {
  const seen = new Map<string, number>();
  return hits.map((hit) => {
    const base = `${hit.serverId}-${hit.target}-${hit.time}-${hit.msgid ?? hit.nick}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  });
}

const HitRow = memo<{
  hit: SearchHit;
  server: Server | undefined;
  showNetwork: boolean;
  pattern: RegExp | null;
  locale: string;
  isOpened: boolean;
  onOpen: (hit: SearchHit) => void;
}>(({ hit, server, showNetwork, pattern, locale, isOpened, onOpen }) => {
  const chat = chatLabel(server, hit.target);
  const where = showNetwork && server ? `${chat} · ${server.name}` : chat;
  const { shown, ranges } = snippetOf(hit.text, pattern);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(hit)}
        aria-current={isOpened || undefined}
        className={`row-interactive items-start py-2 ${isOpened ? "search-hit" : ""}`}
      >
        <MessageAvatar
          userId={hit.nick}
          avatarUrl={findServerUser(server, hit.nick)?.metadata?.avatar?.value}
          theme="discord"
          showHeader
          serverId={hit.serverId}
          showPresence={false}
        />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="truncate font-semibold">{hit.nick}</span>
            <span className="row-meta truncate">{where}</span>
            <span className="row-meta ml-auto shrink-0">
              {formatRelativeTime(hit.time, locale)}
            </span>
          </span>
          <span className="line-clamp-2 break-words font-normal">
            <HighlightedText text={shown} ranges={ranges} />
          </span>
        </span>
      </button>
    </li>
  );
});

const PLACEHOLDER_ROW_IDS = [0, 1, 2];

const GapPlaceholder: React.FC = () => (
  <li aria-hidden className="flex flex-col gap-0.5 blur-[1px]">
    {PLACEHOLDER_ROW_IDS.map((id) => (
      <SkeletonRow
        key={id}
        className="flex items-start gap-2.5 px-2 py-2"
        avatarClassName="w-10 h-10 rounded-full"
      />
    ))}
  </li>
);

// Hits are newest first, so we place a gap before the first hit older than
// its upper edge, and place a gap below the loaded hits once all are loaded.
function gapSlots(
  gaps: HistoryGap[],
  hits: SearchHit[],
  hasMore: boolean,
): Set<number> {
  const slots = new Set<number>();
  for (const gap of gaps) {
    const index = hits.findIndex((hit) => hit.time < gap.to);
    if (index >= 0) slots.add(index);
    else if (!hasMore) slots.add(hits.length);
  }
  return slots;
}

export const SearchPane: React.FC<{ query: SearchQuery }> = ({ query }) => {
  const { i18n } = useLingui();
  const servers = useStore((s) => s.servers);
  const isNarrowView = useStore((s) => s.ui.isNarrowView);
  const closeSearchResults = useStore((s) => s.closeSearchResults);
  const requestChatInputFocus = useStore((s) => s.requestChatInputFocus);
  const isTouch = useIsTouchInput();
  const isLarge = isTouch || isNarrowView;
  const completionId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const draft = useSearchDraft({
    initialText: serializeSearchQuery(query),
    initialScope: query.scope,
    inputRef,
    keysActive: isInputFocused,
    isInPane: true,
  });
  const [searchBar, setSearchBar] = useState<HTMLFormElement | null>(null);
  const { completion } = draft;
  const [hits, setHits] = useState<SearchHit[]>([]);
  // The query behind the hits on screen, which lag the typed one while loading.
  const [shownQuery, setShownQuery] = useState(query);
  const [nextCursor, setNextCursor] = useState<SearchCursor>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<AboutTab>("all");
  const [gapFill, setGapFill] = useState<{
    gaps: HistoryGap[];
    isFetching: boolean;
  }>({ gaps: [], isFetching: false });
  const [fillRound, setFillRound] = useState(0);
  const [fetchedPages, setFetchedPages] = useState(0);
  const isFillRefreshRef = useRef(false);
  const searchRunRef = useRef(0);
  const shownCountRef = useRef(0);
  shownCountRef.current = hits.length;
  const scopeKey = JSON.stringify(query.scope);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey stands for query.scope, and fillRound restarts a fetch the person asked for again
  useEffect(
    () =>
      fillGapsForSearch(useStore, query.scope, (gaps, isFetching, pages) => {
        setGapFill({ gaps, isFetching });
        if (pages === 0) return;
        isFillRefreshRef.current = true;
        setFetchedPages((n) => n + 1);
      }),
    [scopeKey, fillRound],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pane mounts once per search session, so we focus once
  useEffect(() => {
    if (!isTouch) inputRef.current?.focus();
  }, []);

  // We keep the previous results on screen until the new ones arrive, so typing does not flicker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reruns the same query after an error, fetchedPages after each page of missed messages
  useEffect(() => {
    let isCurrent = true;
    searchRunRef.current += 1;
    const isFillRefresh = isFillRefreshRef.current;
    isFillRefreshRef.current = false;
    if (!isFillRefresh) setStatus("loading");
    // On a refresh for fetched messages we read as many hits as are already
    // shown, so the list keeps its length and scroll position.
    const limit = isFillRefresh
      ? Math.max(SEARCH_PAGE_LIMIT, shownCountRef.current)
      : SEARCH_PAGE_LIMIT;
    searchSavedMessages(useStore, query, { limit }).then(
      (page) => {
        if (!isCurrent) return;
        setHits(page.hits);
        setShownQuery(query);
        setNextCursor(cursorOf(page));
        setStatus("ready");
      },
      () => isCurrent && setStatus("error"),
    );
    return () => {
      isCurrent = false;
    };
  }, [query, attempt, fetchedPages]);

  const loadMore = () => {
    if (!nextCursor || status !== "ready" || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const run = searchRunRef.current;
    searchSavedMessages(useStore, query, {
      limit: SEARCH_PAGE_LIMIT,
      ...nextCursor,
    })
      .then(
        (page) => {
          if (searchRunRef.current !== run) return;
          setHits((previous) => [...previous, ...page.hits]);
          setNextCursor(cursorOf(page));
        },
        () => setStatus("error"),
      )
      .finally(() => {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  };

  const close = () => {
    closeSearchResults();
    if (!isTouch) requestChatInputFocus();
  };

  const [openedHit, setOpenedHit] = useState<SearchHit | null>(null);
  const openHit = useCallback(async (hit: SearchHit) => {
    setOpenedHit(hit);
    const result = await jumpToMessage(hit).catch(
      (error: unknown): JumpResult => {
        if (!(error instanceof DOMException)) throw error;
        return { ok: false, reason: "not-found" };
      },
    );
    // A failed jump may already have selected the chat, so we bring the
    // results back where both cannot show at once.
    useStore
      .getState()
      .setSearchChatShown(result.ok, result.ok ? result.messageId : undefined);
    if (!result.ok) reportJumpFailure(hit.serverId, result.reason);
  }, []);

  const shownHits = useMemo(() => {
    if (!shownQuery.aboutMe || tab === "all") return hits;
    return hits.filter((hit) => hit.aboutMe === tab);
  }, [hits, tab, shownQuery.aboutMe]);
  const keys = useMemo(() => hitKeys(shownHits), [shownHits]);

  const pattern = useMemo(
    () => termPattern(`${shownQuery.text} ${shownQuery.mentions ?? ""}`),
    [shownQuery.text, shownQuery.mentions],
  );
  const scopeName = scopeLabel(shownQuery.scope, servers);
  const hasMore = nextCursor !== undefined;
  const slots = gapSlots(gapFill.gaps, shownHits, hasMore);
  const gapSlot = (index: number) =>
    slots.has(index) &&
    (gapFill.isFetching ? (
      <GapPlaceholder key={`gap-${index}`} />
    ) : (
      <li key={`gap-${index}`} className="py-2 flex justify-center">
        <button
          type="button"
          className="chip-action"
          onClick={() => setFillRound((n) => n + 1)}
        >
          <Trans>Fetch missed messages</Trans>
        </button>
      </li>
    ));
  const count = hits.length;
  const countLabel = hasMore
    ? t`${count}+ results`
    : plural(count, { one: "# result", other: "# results" });
  const inputLabel = t`Search messages, filter with from: in: has:link`;
  const touchTarget = isTouch ? `min-h-8 ${touchHitArea}` : "";

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const list = e.currentTarget;
    if (
      list.scrollHeight - list.scrollTop - list.clientHeight <
      LOAD_MORE_MARGIN_PX
    )
      loadMore();
  };

  const closeButton = (icon: React.ReactNode) => (
    <button
      type="button"
      onClick={close}
      className={"icon-button rounded-lg w-10 h-10"}
      title={t`Close search`}
      aria-label={t`Close search`}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-x-hidden bg-discord-dark-100"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || isTouch || draft.isScopeMenuOpen) return;
        e.preventDefault();
        close();
      }}
    >
      <form
        ref={setSearchBar}
        className="h-12 shrink-0 flex items-center gap-1.5 px-2 border-b border-white/[0.06]"
        onSubmit={(e) => {
          e.preventDefault();
          draft.submit();
        }}
      >
        {isNarrowView && closeButton(<FaChevronLeft className="w-3.5 h-3.5" />)}
        <TextInput
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={completion.isOpen}
          aria-controls={completionId}
          aria-activedescendant={
            completion.isOpen
              ? `${completionId}-${completion.selectedIndex}`
              : undefined
          }
          aria-label={inputLabel}
          placeholder={isLarge ? t`Search messages` : inputLabel}
          enterKeyHint="search"
          {...draft.inputProps}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          className={`flex-1 min-w-0 bg-transparent px-1 text-white placeholder:text-discord-text-muted outline-none ${isLarge ? "text-base" : "text-sm"}`}
        />
        {!isNarrowView && closeButton(<FaTimes className="w-3.5 h-3.5" />)}
      </form>

      <SearchQueryBar
        draft={draft}
        isLarge={isLarge}
        completionId={completionId}
        showCompletion={isInputFocused}
        completionAnchor={searchBar ?? undefined}
      />

      <div
        role="status"
        aria-busy={status === "loading"}
        className="px-3 pb-2 row-meta flex items-center gap-2 min-w-0"
      >
        <span className="truncate">
          {status === "error"
            ? t`Search failed`
            : hits.length || status === "ready"
              ? t`${countLabel} in ${scopeName}`
              : t`Searching…`}
        </span>
        {status === "loading" && hits.length > 0 && (
          <LoadingSpinner size="sm" text="" />
        )}
        {gapFill.isFetching && (
          <span className="ml-auto shrink-0 flex items-center gap-1.5">
            <LoadingSpinner size="sm" text="" />
            <Trans>Fetching missed messages…</Trans>
          </span>
        )}
      </div>

      {query.aboutMe && (
        <SegmentedControl
          className="mx-3 mb-2"
          size="sm"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "all", label: <Trans>All</Trans> },
            { value: "mention", label: <Trans>Mentions</Trans> },
            { value: "reply", label: <Trans>Replies</Trans> },
          ]}
        />
      )}

      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-3"
        onScroll={handleListScroll}
      >
        {status === "loading" && hits.length === 0 ? (
          <div className="py-10 flex justify-center">
            <LoadingSpinner size="md" text={t`Searching…`} />
          </div>
        ) : status === "error" ? (
          <div className="px-4 py-10 flex flex-col items-center gap-3 text-center text-sm text-discord-text-muted">
            <Trans>Search failed</Trans>
            <button
              type="button"
              className={`chip-action ${touchTarget}`}
              onClick={() => setAttempt((n) => n + 1)}
            >
              <Trans>Search again</Trans>
            </button>
          </div>
        ) : shownHits.length === 0 && !hasMore && slots.size === 0 ? (
          <div className="px-4 py-10 flex flex-col items-center gap-3 text-center text-sm text-discord-text-muted">
            <Trans>
              No messages match. Search more chats or change the filters
            </Trans>
            {query.scope.kind !== "everywhere" && (
              <button
                type="button"
                className={`chip-action ${touchTarget}`}
                onClick={() => draft.setScope(widenScope(query.scope))}
              >
                <Trans>Search more chats</Trans>
              </button>
            )}
          </div>
        ) : (
          <ul
            className={`flex flex-col gap-0.5 transition-opacity ${status === "loading" ? "opacity-60" : ""}`}
          >
            {shownHits.map((hit, index) => [
              gapSlot(index),
              <HitRow
                key={keys[index]}
                hit={hit}
                server={servers.find((s) => s.id === hit.serverId)}
                showNetwork={shownQuery.scope.kind === "everywhere"}
                pattern={pattern}
                locale={i18n.locale}
                isOpened={hit === openedHit}
                onOpen={openHit}
              />,
            ])}
            {gapSlot(shownHits.length)}
          </ul>
        )}
        {status === "ready" && hasMore && (
          <div className="py-3 flex justify-center">
            <button
              type="button"
              className={`chip-action ${touchTarget}`}
              disabled={isLoadingMore}
              onClick={loadMore}
            >
              {isLoadingMore ? t`Loading…` : t`Load more results`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPane;
