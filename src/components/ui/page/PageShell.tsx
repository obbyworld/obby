import { t } from "@lingui/core/macro";
import type React from "react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { useIsTouchInput } from "../../../hooks/useIsTouchInput";
import { flashHighlight, highlightRow } from "../../../lib/highlightRow";
import useStore from "../../../store";
import SwipeBackScreen from "../../layout/SwipeBackScreen";

export interface PageSection {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

interface PageShellProps {
  title: string;
  children: ReactNode;
  sections?: PageSection[];
  activeSection?: string;
  onSectionChange?: (id: string) => void;
  /** Phone only: open straight on the active section rather than the section list. */
  startOnSection?: boolean;
  /** Under the title in the section column, e.g. a search field. */
  navExtra?: ReactNode;
  headerActions?: ReactNode;
  /** Full-width content for lists and logs; forms keep a readable column. */
  wide?: boolean;
  /** The content fills the page height and scrolls itself, e.g. a log. */
  fill?: boolean;
  /** Where Back goes when it is not the chat, e.g. a sub-page of Settings. */
  back?: { label: string; onBack: () => void };
}

let pageBack: (() => void) | null = null;

// A page drawn under a swiped page is only a picture of where back leads, so
// it must not take the back button, Escape or focus from the live one.
export const PagePreviewContext = createContext(false);

// Swipe back and the Android back button take the same step as the page's own
// back button: a section returns to the section list before the page closes.
export function goBackInPage(): boolean {
  if (!pageBack) return false;
  pageBack();
  return true;
}

const TEXT_FIELD = "input, textarea, select, [contenteditable='true']";
const HIGHLIGHT_WAIT_MS = 1500;

function useBackLabel(): string {
  return useStore((s) => {
    const serverId = s.ui.selectedServerId;
    const isOverChat =
      !s.ui.isNarrowView || s.ui.mobileViewActiveColumn === "chatView";
    if (!serverId || !isOverChat) return t`Back`;
    const selection = s.ui.perServerSelections[serverId];
    const server = s.servers.find((x) => x.id === serverId);
    const channel = server?.channels.find(
      (c) => c.id === selection?.selectedChannelId,
    );
    if (channel) return t`Back to ${channel.name}`;
    const pm = server?.privateChats.find(
      (p) => p.id === selection?.selectedPrivateChatId,
    );
    return pm ? t`Back to ${pm.username}` : t`Back`;
  });
}

// We scroll the row Ctrl+K picked into the middle and flash it. Rows can
// arrive after async data loads, so we poll for the element for a moment.
function useHighlightRow(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const page = useStore((s) => s.ui.page);
  const highlight =
    page?.fromSearch && "highlight" in page ? page.highlight : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page object is a new jump, even to the same row; switching sections later must not replay it
  useEffect(() => {
    if (!highlight) return;
    let frame = 0;
    let endHighlight: (() => void) | undefined;
    const startedAt = performance.now();
    const tryHighlight = () => {
      const container = scrollRef.current;
      const row = container?.querySelector<HTMLElement>(
        `[id="setting-${CSS.escape(highlight)}"]`,
      );
      if (!container || !row) {
        if (performance.now() - startedAt < HIGHLIGHT_WAIT_MS)
          frame = requestAnimationFrame(tryHighlight);
        return;
      }
      endHighlight = highlightRow(container, row);
    };
    frame = requestAnimationFrame(tryHighlight);
    return () => {
      cancelAnimationFrame(frame);
      endHighlight?.();
    };
  }, [page]);
  return highlight;
}

// Every in-app page (Settings, server and channel settings, the channel
// browser, bots, the raw log) renders in the chat column through this shell,
// so they share the header, back button, section list and Ctrl+K highlight.
export const PageShell: React.FC<PageShellProps> = ({
  title,
  children,
  sections,
  activeSection,
  onSectionChange,
  startOnSection = false,
  navExtra,
  headerActions,
  wide = false,
  fill = false,
  back,
}) => {
  const closePageStore = useStore((s) => s.closePage);
  const onBackRef = useRef(back?.onBack ?? closePageStore);
  onBackRef.current = back?.onBack ?? closePageStore;
  // We blur first so a field that saves on blur commits before the page unmounts.
  const closePage = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    onBackRef.current();
  }, []);
  const isTouch = useIsTouchInput();
  const isPreview = useContext(PagePreviewContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const isNarrow = useStore((s) => s.ui.isNarrowView);
  const chatBackLabel = useBackLabel();
  const backLabel = back?.label ?? chatBackLabel;
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlight = useHighlightRow(scrollRef);
  const [isShowingSectionList, setIsShowingSectionList] = useState(
    !startOnSection && !highlight,
  );

  useEffect(() => {
    if (highlight) setIsShowingSectionList(false);
  }, [highlight]);

  useEffect(() => {
    if (isPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[aria-modal='true'], [data-popover-panel]"))
        return;
      // The first Escape leaves a text field, so a stray press keeps the page.
      const target = e.target;
      if (target instanceof HTMLElement && target.matches(TEXT_FIELD)) {
        target.blur();
        return;
      }
      closePage();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePage, isPreview]);

  // We move focus into the page for keyboard and screen reader users; touch
  // skips it so the page opens without raising the keyboard.
  useEffect(() => {
    if (!isTouch && !isPreview)
      rootRef.current
        ?.querySelector<HTMLElement>("h1")
        ?.focus({ preventScroll: true });
  }, [isTouch, isPreview]);

  const page = useStore((s) => s.ui.page);
  const jumpedSection =
    page?.fromSearch && "section" in page && !highlight
      ? page.section
      : undefined;
  // A Ctrl+K jump to a whole section flashes its title, the way a jump to a
  // single setting flashes that row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page object is a new jump
  useEffect(() => {
    if (!jumpedSection) return;
    const title = rootRef.current?.querySelector<HTMLElement>("header h1");
    if (title) return flashHighlight(title);
  }, [page]);

  const hasSections = !!sections?.length;
  const isInSection = isNarrow && hasSections && !isShowingSectionList;
  const showSectionList = useCallback(() => setIsShowingSectionList(true), []);
  const stepBack = isInSection ? showSectionList : closePage;
  useEffect(() => {
    if (isPreview) return;
    pageBack = stepBack;
    return () => {
      if (pageBack === stepBack) pageBack = null;
    };
  }, [stepBack, isPreview]);
  const sectionTitle =
    sections?.find((s) => s.id === activeSection)?.label ?? title;

  const backButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="icon-button w-10 h-10 rounded-lg"
    >
      <FaChevronLeft className="w-3.5 h-3.5" />
    </button>
  );

  const body = (
    <div
      ref={scrollRef}
      className={`flex-1 min-h-0 flex flex-col ${
        fill ? "" : "overflow-y-auto overscroll-contain"
      }`}
    >
      <div
        className={`mx-auto w-full flex flex-col gap-6 ${
          wide ? "max-w-[1040px]" : "max-w-[720px]"
        } ${fill ? "flex-1 min-h-0" : ""} ${isNarrow ? "px-3 py-4" : "px-8 py-7"}`}
        style={{
          paddingBottom: "max(1.5rem, var(--safe-area-inset-bottom, 0px))",
        }}
      >
        {!hasSections && navExtra}
        {children}
      </div>
    </div>
  );

  const header = (leading: ReactNode, heading: string) => (
    <header className="h-12 shrink-0 flex items-center gap-1.5 pl-2 pr-3 bar-divider">
      {leading}
      <h1
        tabIndex={-1}
        className="flex-1 min-w-0 truncate px-1 text-[15px] font-semibold text-white outline-none"
      >
        {heading}
      </h1>
      {headerActions}
    </header>
  );

  if (isNarrow) {
    const sectionList = (
      <div
        ref={isShowingSectionList ? rootRef : undefined}
        className="flex flex-col h-full min-h-0 bg-discord-dark-200"
      >
        {header(backButton(backLabel, closePage), title)}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
          {navExtra && <div className="mb-3">{navExtra}</div>}
          <div className="page-card">
            {sections?.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  onSectionChange?.(section.id);
                  setIsShowingSectionList(false);
                }}
                className="w-full min-h-14 flex items-center gap-3 px-3 py-3 text-left active:bg-discord-dark-400/50"
              >
                {section.icon && (
                  <span className="w-5 flex justify-center text-discord-text-muted">
                    {section.icon}
                  </span>
                )}
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[15px] text-white">
                    {section.label}
                  </span>
                  {section.description && (
                    <span className="text-[13px] text-discord-text-muted truncate">
                      {section.description}
                    </span>
                  )}
                </span>
                <FaChevronRight className="w-3 h-3 text-discord-text-muted" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
    if (hasSections && isShowingSectionList) return sectionList;
    const screen = (
      <div
        ref={rootRef}
        className="flex flex-col h-full min-h-0 bg-discord-dark-200"
      >
        {header(
          backButton(hasSections ? title : backLabel, stepBack),
          sectionTitle,
        )}
        {body}
      </div>
    );
    return hasSections && !isPreview ? (
      <SwipeBackScreen under={sectionList} onBack={showSectionList}>
        {screen}
      </SwipeBackScreen>
    ) : (
      screen
    );
  }

  if (!hasSections) {
    return (
      <div
        ref={rootRef}
        className="flex flex-col h-full min-h-0 bg-discord-dark-200"
      >
        {header(backButton(backLabel, closePage), title)}
        {body}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <nav
        aria-label={title}
        className="w-60 shrink-0 flex flex-col gap-3 px-2.5 py-3 bg-discord-dark-100 overflow-y-auto"
      >
        <button
          type="button"
          onClick={closePage}
          className="self-start flex items-center gap-1.5 h-8 px-2 rounded-md text-[13px] text-discord-text-muted hover:text-white hover:bg-white/[0.06]"
        >
          <FaChevronLeft className="w-3 h-3" />
          <span className="truncate max-w-[180px]">{backLabel}</span>
        </button>
        <h2 className="px-2 text-xl font-semibold text-white">{title}</h2>
        {navExtra}
        <div className="flex flex-col gap-1">
          {sections?.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={section.id === activeSection ? "page" : undefined}
              onClick={() => onSectionChange?.(section.id)}
              className={`h-9 flex items-center gap-2.5 px-2.5 rounded-md text-left text-sm shadow-sm transition-colors ${
                section.id === activeSection
                  ? "bg-black text-white font-medium"
                  : "bg-discord-dark-400/50 text-discord-text-muted hover:text-white hover:bg-discord-dark-400/80"
              }`}
            >
              {section.icon && (
                <span className="w-4 flex justify-center opacity-80">
                  {section.icon}
                </span>
              )}
              <span className="truncate">{section.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-w-0 flex flex-col bg-discord-dark-200">
        {header(null, sectionTitle)}
        {body}
      </div>
    </div>
  );
};

export default PageShell;
