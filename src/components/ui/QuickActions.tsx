import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaSearch, FaTimes } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import { fuzzyMatch } from "../../lib/fuzzySearch";
import ircClient from "../../lib/ircClient";
import { isMac } from "../../lib/platformUtils";
import {
  clearRecentSearches,
  getRecentPlaces,
  getRecentSearches,
} from "../../lib/search/recents";
import { widenScope } from "../../lib/search/searchQuery";
import { currentChatScope, scopeLabel } from "../../lib/search/searchScope";
import useStore from "../../store";
import type { QuickActionsMode } from "../../store/types";
import SearchQueryBar from "../search/SearchQueryBar";
import { useSearchDraft } from "../search/useSearchDraft";
import { buildQuickActionContext } from "./QuickActions/context";
import { buildGotoResults } from "./QuickActions/gotoResults";
import {
  buildRecentResults,
  buildUnreadResults,
} from "./QuickActions/recentResults";
import {
  MatchedText,
  resultGroupTitle,
  resultIcon,
  UnreadIndicator,
} from "./QuickActions/resultMeta";
import type { QuickActionResult } from "./QuickActions/types";
import { useResultActions } from "./QuickActions/useResultActions";
import SegmentedControl from "./SegmentedControl";
import { TextInput } from "./TextInput";

const RAIL_WIDTH = __HIDE_SERVER_LIST__ ? "8px" : "72px";
const keepInputFocus = (e: React.MouseEvent) => e.preventDefault();
const NO_KEYS: string[] = [];

interface ResultGroup {
  title: string;
  start: number;
  results: QuickActionResult[];
}

function groupsOf(results: QuickActionResult[]): ResultGroup[] {
  const groups: ResultGroup[] = [];
  results.forEach((result, index) => {
    const title = resultGroupTitle(result);
    const last = groups[groups.length - 1];
    if (last?.title === title) last.results.push(result);
    else groups.push({ title, start: index, results: [result] });
  });
  return groups;
}

const QuickActions: React.FC = () => {
  const servers = useStore((s) => s.servers);
  const ui = useStore((s) => s.ui);
  const channelList = useStore((s) => s.channelList);
  const globalSettings = useStore((s) => s.globalSettings);
  const currentUser = useStore((s) => s.currentUser);
  const { i18n } = useLingui();
  const runResult = useResultActions();
  const isTouch = useIsTouchInput();
  const isSheet = isTouch || ui.isNarrowView;
  const mode: QuickActionsMode = ui.quickActions?.mode ?? "goto";
  const isGoto = mode === "goto";
  const currentServerId = ui.selectedServerId;
  const currentSelection = currentServerId
    ? (ui.perServerSelections[currentServerId] ?? null)
    : null;

  const inputRef = useRef<HTMLInputElement>(null);
  const [returnFocusTo] = useState(() => document.activeElement);
  const [recentSearches, setRecentSearches] = useState(getRecentSearches);
  const [recentPlaces] = useState(getRecentPlaces);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const listId = useId();
  const completionId = useId();

  const draft = useSearchDraft({
    initialScope:
      ui.quickActions?.scope ??
      currentChatScope(servers, currentServerId, currentSelection),
    inputRef,
    isMessageSearch: !isGoto,
  });
  const { text, scope, completion } = draft;
  const query = text.trim();

  const close = () => {
    useStore.getState().toggleQuickActions(false);
    if (isTouch) return;
    if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected)
      returnFocusTo.focus();
    else useStore.getState().requestChatInputFocus();
  };

  const recentResults = useMemo(
    () => buildRecentResults(recentSearches, recentPlaces, servers),
    [recentSearches, recentPlaces, servers],
  );

  const gotoResults = useMemo(() => {
    if (!isGoto || query.length === 0) return [];
    return buildGotoResults({
      query,
      servers,
      channelList,
      context: buildQuickActionContext(
        servers,
        ui,
        currentServerId,
        currentSelection,
        globalSettings,
        currentUser,
      ),
      ownNick: currentServerId
        ? ircClient.getCurrentUser(currentServerId)?.username
        : undefined,
      translate: (descriptor) => i18n._(descriptor),
    });
  }, [
    isGoto,
    query,
    servers,
    channelList,
    ui,
    globalSettings,
    currentUser,
    currentServerId,
    currentSelection,
    i18n,
  ]);

  const results: QuickActionResult[] = useMemo(() => {
    if (query.length === 0)
      return [
        ...recentResults,
        ...buildUnreadResults(servers, currentServerId, currentSelection),
      ];
    const searchRow: QuickActionResult = {
      type: "search-messages",
      id: "search-messages",
      title: t`Search messages for "${query}"`,
      description: scopeLabel(scope, servers),
      score: 0,
    };
    if (isGoto) return [...gotoResults, searchRow];
    const matchingSearches = recentResults.filter(
      (result) =>
        result.type === "recent-search" &&
        fuzzyMatch(query, result.title).matches,
    );
    return [searchRow, ...matchingSearches];
  }, [
    query,
    isGoto,
    scope,
    servers,
    gotoResults,
    recentResults,
    currentServerId,
    currentSelection,
  ]);
  const groups = useMemo(() => groupsOf(results), [results]);

  const select = (result: QuickActionResult) => {
    if (result.type === "search-messages") {
      draft.submit();
      return;
    }
    runResult(result);
    const state = useStore.getState();
    if (state.ui.quickActions) state.toggleQuickActions(false);
    if (!isTouch && result.type !== "recent-search")
      state.requestChatInputFocus();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: we restart at the top whenever the list changes meaning
  useEffect(() => setSelectedIndex(0), [query, mode]);

  useSuggestionKeys({
    isActive: !completion.isOpen && !draft.isScopeMenuOpen,
    count: results.length,
    selectedIndex,
    onMove: setSelectedIndex,
    onAccept: (index) => {
      if (document.activeElement instanceof HTMLButtonElement) return false;
      const result = results[index];
      if (result) select(result);
      return true;
    },
    onClose: close,
    closeKeys: NO_KEYS,
  });

  const closeRef = useRef(close);
  const isScopeMenuOpenRef = useRef(false);
  closeRef.current = close;
  isScopeMenuOpenRef.current = draft.isScopeMenuOpen;

  // An open completion list takes Escape first in the capture phase, and
  // Android back arrives as an Escape on the document.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isScopeMenuOpenRef.current) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key !== "Backspace" ||
      e.repeat ||
      text !== "" ||
      isGoto ||
      scope.kind === "everywhere"
    )
      return;
    e.preventDefault();
    const wider = widenScope(scope);
    draft.setScope(wider);
    const label = scopeLabel(wider, servers);
    setAnnouncement(t`Searching in ${label}`);
  };

  const clearSearches = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  const inputLabel = isGoto
    ? t`Find channels, people, settings and actions`
    : t`Search messages, filter with from: in: has:link`;
  const optionId = (index: number) => `${listId}-${index}`;
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  const panelStyle: React.CSSProperties = isSheet
    ? {
        bottom: "var(--keyboard-height, 0px)",
        paddingTop: "var(--safe-area-inset-top, 0px)",
      }
    : {
        top: 8,
        left: `calc(var(--safe-area-inset-left, 0px) + ${RAIL_WIDTH})`,
        width: `min(760px, calc(100vw - ${RAIL_WIDTH} - 16px))`,
      };

  return (
    <div
      className={`fixed inset-0 z-50 animate-in fade-in duration-100 ${isSheet ? "" : "bg-black/50"}`}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={inputLabel}
        className={`absolute flex flex-col overflow-hidden ${
          isSheet ? "inset-x-0 top-0 bg-discord-dark-200" : "surface-floating"
        }`}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center gap-2 px-2 bar-divider ${isSheet ? "h-14" : "h-12 px-4"}`}
        >
          {isSheet ? (
            <button
              type="button"
              onClick={close}
              aria-label={t`Close`}
              className="icon-button w-11 h-11 rounded-lg"
            >
              <FaArrowLeft />
            </button>
          ) : (
            <FaSearch className="w-4 h-4 text-discord-text-muted shrink-0" />
          )}
          <TextInput
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={completion.isOpen || results.length > 0}
            aria-controls={completion.isOpen ? completionId : listId}
            aria-activedescendant={
              completion.isOpen
                ? `${completionId}-${completion.selectedIndex}`
                : results.length > 0
                  ? optionId(selectedIndex)
                  : undefined
            }
            aria-label={inputLabel}
            placeholder={inputLabel}
            enterKeyHint="search"
            {...draft.inputProps}
            onKeyDown={handleInputKeyDown}
            className={`flex-1 min-w-0 bg-transparent text-white placeholder:text-discord-text-muted outline-none ${isSheet ? "text-base" : "text-[15px]"}`}
            autoFocus
          />
          {!isSheet && (
            <button
              type="button"
              onClick={close}
              aria-label={t`Close`}
              className="icon-button w-10 h-10 rounded-lg"
            >
              <FaTimes />
            </button>
          )}
        </div>

        <div
          className={`flex px-3 ${isSheet ? "pt-2" : "pt-1.5"} ${isGoto ? "pb-2" : ""}`}
        >
          <SegmentedControl
            className="shrink-0"
            size={isSheet ? "lg" : "sm"}
            value={mode}
            onChange={(next) =>
              useStore.getState().openQuickActions(next, ui.quickActions?.scope)
            }
            onMouseDown={keepInputFocus}
            segments={[
              { value: "goto", label: <Trans>Go to</Trans> },
              { value: "messages", label: <Trans>Messages</Trans> },
            ]}
          />
        </div>

        {!isGoto && (
          <SearchQueryBar
            draft={draft}
            isLarge={isSheet}
            completionId={completionId}
            completionClassName={isSheet ? "flex-1" : ""}
          />
        )}

        <div role="status" className="sr-only">
          {announcement}
        </div>

        {!completion.isOpen && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={inputLabel}
            className={`overflow-y-auto overscroll-contain p-2 ${isSheet ? "flex-1" : ""}`}
            style={isSheet ? undefined : { maxHeight: "min(60vh, 520px)" }}
          >
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-discord-text-muted">
                {query.length > 0
                  ? t`No results. Try fewer letters`
                  : isGoto
                    ? t`No unread mentions or messages. Type to search`
                    : t`Type words to search messages`}
              </div>
            ) : (
              groups.map((group) => {
                const titleId = `${listId}-group-${group.start}`;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group", which a fieldset does not give
                  <div key={group.title} role="group" aria-labelledby={titleId}>
                    <div className="flex items-center pt-2.5">
                      <div id={titleId} className="section-label flex-1">
                        {group.title}
                      </div>
                      {group.results[0].type === "recent-search" && (
                        <button
                          type="button"
                          className={`row-meta px-2 rounded hover:text-white ${isSheet ? "min-h-11" : ""}`}
                          onMouseDown={keepInputFocus}
                          onClick={clearSearches}
                        >
                          <Trans>Clear</Trans>
                        </button>
                      )}
                    </div>
                    {group.results.map((result, offset) => {
                      const index = group.start + offset;
                      const isSelected = index === selectedIndex;
                      return (
                        <button
                          key={result.id}
                          type="button"
                          id={optionId(index)}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          data-result-index={index}
                          onClick={() => select(result)}
                          onMouseMove={() =>
                            !isSelected && setSelectedIndex(index)
                          }
                          className={`row-interactive gap-3 ${isSheet ? "min-h-12" : ""} ${isSelected ? "row-interactive-active" : ""}`}
                        >
                          <span className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[13px] bg-black/20">
                            {resultIcon(result)}
                          </span>
                          <span className="flex-1 min-w-0 flex flex-col">
                            <span className="truncate">
                              {isGoto ? (
                                <MatchedText
                                  text={result.title}
                                  query={query}
                                />
                              ) : (
                                result.title
                              )}
                            </span>
                            {result.description && (
                              <span className="row-meta truncate">
                                {result.description}
                              </span>
                            )}
                          </span>
                          <UnreadIndicator result={result} />
                          {isSelected && !isSheet && (
                            <span className="row-meta shrink-0">↵</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        )}
        {!isSheet && (
          <div className="flex flex-wrap gap-x-4 px-4 py-2 items-center row-meta shadow-[0_-1px_0_rgba(0,0,0,0.25)]">
            <span>{t`↑ ↓ to move`}</span>
            <span>{t`↵ to open`}</span>
            <span>{t`${shortcut} to switch mode`}</span>
            <span>{t`esc to close`}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickActions;
