import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBackButton } from "../../hooks/useBackButton";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation";
import useStore from "../../store";
import type { layoutColumn } from "../../store/types";
import { ChannelLinkProvider } from "../message/ChannelLinkProvider";
import PageHost, { preloadPages } from "../pages/PageHost";
import { GlobalNotifications } from "../ui/GlobalNotifications";
import LinkHoverLayer from "../ui/LinkHoverLayer";
import { MediaViewerModal } from "../ui/MediaViewerModal";
import { goBackInPage } from "../ui/page/PageShell";
import TitleTooltipLayer from "../ui/TitleTooltipLayer";
import { VoicePipOverlay } from "../voice/VoicePipOverlay";
import { ChannelList } from "./ChannelList";
import { ChatArea } from "./ChatArea";
import { PageLayer } from "./PageLayer";
import { ResizableSidebar } from "./ResizableSidebar";
import { ServerList } from "./ServerList";
import { SidePane } from "./SidePane";
import { VoiceChannelView } from "./VoiceChannelView";

const PAGE_ORDER: layoutColumn[] = ["serverList", "chatView", "memberList"];
const getPageIndex = (column: layoutColumn): number =>
  PAGE_ORDER.indexOf(column);
const getColumnFromPage = (page: number): layoutColumn => PAGE_ORDER[page];

export const AppLayout: React.FC = () => {
  const {
    sidebarPreferences,
    selectedServerId,
    perServerSelections,
    isDarkMode,
    isMobileMenuOpen,
    isMemberListVisible,
    isChannelListVisible,
    mobileViewActiveColumn,
    page,
    sidePane,
    isNarrowView,
    openedMedia,
    toggleMobileMenu,
    toggleMemberList,
    toggleChannelList,
    setMobileViewActiveColumn,
    setIsNarrowView,
    closeMedia,
  } = useStore(
    useShallow((state) => ({
      sidebarPreferences: state.ui.sidebarPreferences,
      selectedServerId: state.ui.selectedServerId,
      perServerSelections: state.ui.perServerSelections,
      isDarkMode: state.ui.isDarkMode,
      isMobileMenuOpen: state.ui.isMobileMenuOpen,
      isMemberListVisible: state.ui.isMemberListVisible,
      isChannelListVisible: state.ui.isChannelListVisible,
      mobileViewActiveColumn: state.ui.mobileViewActiveColumn,
      page: state.ui.page,
      sidePane: state.ui.sidePane,
      isNarrowView: state.ui.isNarrowView,
      openedMedia: state.ui.openedMedia,
      toggleMobileMenu: state.toggleMobileMenu,
      toggleMemberList: state.toggleMemberList,
      toggleChannelList: state.toggleChannelList,
      setMobileViewActiveColumn: state.setMobileViewActiveColumn,
      setIsNarrowView: state.setIsNarrowView,
      closeMedia: state.closeMedia,
    })),
  );

  const [serverNamesExpanded, setServerNamesExpanded] = useState(() => {
    try {
      return localStorage.getItem("obby-server-names-expanded") !== "false";
    } catch {
      return true;
    }
  });
  const toggleServerNames = () =>
    setServerNamesExpanded((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("obby-server-names-expanded", String(next));
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });

  const [channelListWidth, setChannelListWidth] = useState<number>(
    sidebarPreferences?.channelList.width ?? 264,
  );
  const [memberListWidth, setMemberListWidth] = useState<number>(
    sidebarPreferences?.memberList.width ?? 280,
  );

  const currentSelection = perServerSelections[selectedServerId || ""] || {
    selectedChannelId: null,
    selectedPrivateChatId: null,
  };
  const { selectedChannelId, selectedPrivateChatId } = currentSelection;

  const selectedChannel = useStore((s) => {
    if (!selectedServerId || !selectedChannelId) return null;
    const srv = s.servers.find((x) => x.id === selectedServerId);
    return srv?.channels.find((c) => c.id === selectedChannelId) ?? null;
  });
  // Both ^ (voice) and $ (stream) channels render through VoiceChannelView.
  // The view itself reads the room mode from VoiceState.mode and adapts
  // its layout (publishing controls vs viewer chat).
  const isVoiceChannel =
    !!selectedChannel?.name.startsWith("^") ||
    !!selectedChannel?.name.startsWith("$");
  const hasSidePane = !!sidePane;

  const isBouncerControlSelected = useStore(
    (s) =>
      !!selectedServerId &&
      !!s.servers.find((x) => x.id === selectedServerId)?.isBouncerControl,
  );

  const shouldShowMemberList =
    isMemberListVisible &&
    !!selectedChannel &&
    !selectedPrivateChatId &&
    !isBouncerControlSelected;

  const handleChannelListWidthChange = useCallback((width: number) => {
    setChannelListWidth(width);
    useStore.getState().updateSidebarPreferences({
      channelList: {
        isVisible: useStore.getState().ui.isChannelListVisible,
        width,
      },
    });
  }, []);

  const handleMemberListWidthChange = useCallback((width: number) => {
    setMemberListWidth(width);
    useStore.getState().updateSidebarPreferences({
      memberList: {
        // isMemberListVisible (user's actual preference) not shouldShowMemberList
        // (which is false for PMs, causing isVisible:false to be incorrectly saved)
        isVisible: useStore.getState().ui.isMemberListVisible,
        width,
      },
    });
  }, []);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 2000));
    idle(() => preloadPages());
  }, []);

  // Set theme class on body
  useEffect(() => {
    document.body.classList.toggle("dark", isDarkMode);
    document.body.classList.toggle("light", !isDarkMode);

    // Set data-theme for daisyUI
    document.documentElement.setAttribute("data-theme", "discord");

    // Set background color
    document.body.style.backgroundColor = isDarkMode ? "#202225" : "#ffffff";
  }, [isDarkMode]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isMobileMenuOpen) {
        const target = e.target as HTMLElement;
        if (
          !target.closest(".server-list") &&
          !target.closest(".channel-list")
        ) {
          toggleMobileMenu(false);
        }
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isMobileMenuOpen, toggleMobileMenu]);

  const isNarrowViewFromHook = useMediaQuery();
  const isTooNarrowForMemberList = useMediaQuery("(max-width: 1080px)");

  // Desktop narrow: member list shows as overlay in ChatArea instead of sidebar
  const showMemberListAsOverlay = !isNarrowView && isTooNarrowForMemberList;
  const shouldShowMemberListSidebar =
    (shouldShowMemberList || hasSidePane) && !showMemberListAsOverlay && !page;

  // Member list page doesn't exist in DMs — only channels have a member list.
  const hasMemberPage =
    (!!selectedServerId && !selectedPrivateChatId) || hasSidePane;

  // Clamp the active column synchronously so currentPageIndex is never out of
  // range during the same render that totalPages drops from 3 to 2 (e.g. when
  // switching from a channel to a DM while on the member-list page).
  const effectiveMobileColumn =
    !hasMemberPage && mobileViewActiveColumn === "memberList"
      ? "chatView"
      : mobileViewActiveColumn;

  const currentPageIndex = getPageIndex(effectiveMobileColumn);
  const totalPages = hasMemberPage ? 3 : 2;

  // Persist the corrected column back into the store after paint.
  useEffect(() => {
    if (effectiveMobileColumn !== mobileViewActiveColumn) {
      setMobileViewActiveColumn(effectiveMobileColumn);
    }
  }, [
    effectiveMobileColumn,
    mobileViewActiveColumn,
    setMobileViewActiveColumn,
  ]);

  const openPage = useStore((s) => s.openPage);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        (event.key === "L" || event.key === "l")
      ) {
        const state = useStore.getState();
        const targetServerId =
          state.ui.selectedServerId ?? state.servers[0]?.id ?? null;
        if (targetServerId) {
          event.preventDefault();
          openPage({ kind: "rawLog", serverId: targetServerId });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openPage]);

  const {
    containerRef,
    offset,
    isTransitioning,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useSwipeNavigation({
    currentPage: currentPageIndex,
    totalPages,
    onPageChange: (page) => setMobileViewActiveColumn(getColumnFromPage(page)),
  });

  const getLayoutColumnElement = (column: layoutColumn) => {
    switch (column) {
      case "serverList":
        if (isNarrowView) {
          return (
            <div className="flex w-full h-full">
              {__HIDE_SERVER_LIST__ ? null : (
                <div
                  className="server-list flex-shrink-0 h-full min-h-0 bg-discord-dark-300 select-none"
                  style={{
                    width: serverNamesExpanded ? "min(46vw, 200px)" : "72px",
                  }}
                >
                  <ServerList
                    expanded={serverNamesExpanded}
                    onToggleExpanded={toggleServerNames}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0 h-full bg-discord-dark-100">
                <ChannelList />
              </div>
            </div>
          );
        }
        return (
          <>
            {__HIDE_SERVER_LIST__ ? null : (
              <div
                className="server-list flex-shrink-0 h-full min-h-0 bg-discord-dark-300 z-30 select-none"
                style={{ width: serverNamesExpanded ? "224px" : "72px" }}
              >
                <ServerList
                  expanded={serverNamesExpanded}
                  onToggleExpanded={toggleServerNames}
                />
              </div>
            )}
            <ResizableSidebar
              bypass={false}
              isVisible={isChannelListVisible && !page}
              defaultWidth={264}
              initialWidth={channelListWidth}
              minWidth={80}
              maxWidth={400}
              side="left"
              onMinReached={() => toggleChannelList(false)}
              onWidthChange={handleChannelListWidthChange}
            >
              <div className="channel-list w-full h-full bg-discord-dark-100 md:block z-20">
                <ChannelList />
              </div>
            </ResizableSidebar>
          </>
        );
      case "chatView": {
        const overlay = page && !isNarrowView && <PageHost page={page} />;
        // A page covers the chat and keeps it mounted, so the draft, the
        // scroll position and a running call survive opening Settings.
        const voiceTopSlot =
          isVoiceChannel && selectedServerId && selectedChannel ? (
            <VoiceChannelView
              serverId={selectedServerId}
              channelName={selectedChannel.name}
            />
          ) : undefined;
        return (
          <div
            className={`${isNarrowView ? "w-full" : "flex-grow"} h-full bg-discord-dark-200 flex flex-col min-w-0 z-10`}
          >
            {overlay}
            <div className={overlay ? "hidden" : "contents"}>
              <ChatArea
                isChanListVisible={isChannelListVisible}
                onToggleChanList={() => {
                  if (isNarrowView) {
                    setMobileViewActiveColumn("serverList");
                  } else {
                    toggleChannelList(!isChannelListVisible);
                  }
                }}
                topSlot={voiceTopSlot}
              />
            </div>
          </div>
        );
      }
      case "memberList":
        if (isNarrowView) {
          return (
            <div className="w-full h-full bg-discord-dark-100">
              <SidePane />
            </div>
          );
        }
        return (
          <ResizableSidebar
            bypass={false}
            isVisible={shouldShowMemberListSidebar}
            defaultWidth={280}
            initialWidth={memberListWidth}
            minWidth={80}
            maxWidth={400}
            side="right"
            onMinReached={() => toggleMemberList(false)}
            onWidthChange={handleMemberListWidthChange}
          >
            <div className="flex-1 overflow-hidden h-full bg-discord-dark-100">
              <SidePane />
            </div>
          </ResizableSidebar>
        );
    }
  };

  // Sync media query hook to store
  useEffect(() => {
    setIsNarrowView(isNarrowViewFromHook);
  }, [isNarrowViewFromHook, setIsNarrowView]);

  const getLayoutColumn = (column: layoutColumn) => {
    // Desktop: use explicit visibility flags
    if (!isNarrowView) {
      if (column === "serverList") return getLayoutColumnElement("serverList");
      if (column === "chatView") return getLayoutColumnElement("chatView");
      if (column === "memberList" && shouldShowMemberListSidebar) {
        return getLayoutColumnElement("memberList");
      }
      return null;
    }

    // Mobile: only show active column
    if (column !== mobileViewActiveColumn) return null;
    return getLayoutColumnElement(column);
  };

  useBackButton(() => {
    // An open dialog, sheet or menu closes on Escape, so back closes it
    // before it moves anything underneath.
    if (document.querySelector("[aria-modal='true'], [data-popover-panel]")) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return false;
    }
    if (useStore.getState().ui.openedMedia) {
      useStore.getState().closeMedia();
      return false;
    }
    const {
      page: openedPage,
      sidePane: openedPane,
      mobileViewActiveColumn: activeColumn,
    } = useStore.getState().ui;
    if (openedPage) {
      if (!goBackInPage()) useStore.getState().closePage();
      return false;
    }
    if (openedPane?.kind === "profile") {
      useStore.getState().closeProfile();
      return false;
    }
    if (openedPane?.kind === "search") {
      if (activeColumn === "chatView")
        useStore.getState().setSearchChatShown(false);
      else useStore.getState().closeSearchResults();
      return false;
    }
    if (!isNarrowView) return true;
    switch (mobileViewActiveColumn) {
      case "chatView":
        setMobileViewActiveColumn("serverList");
        toggleChannelList(true);
        return false;
      case "memberList":
        setMobileViewActiveColumn("chatView");
        toggleMemberList(false);
        return false;
      default:
        return true;
    }
  });

  return (
    <ChannelLinkProvider>
      <div
        className={`flex h-full overflow-hidden bg-discord-dark-300 ${
          isDarkMode ? "text-white" : "text-gray-900"
        }`}
        style={{
          paddingTop: "var(--safe-area-inset-top)",
          paddingRight: "var(--safe-area-inset-right)",
          paddingLeft: "var(--safe-area-inset-left)",
        }}
      >
        {isNarrowView ? (
          <div
            ref={containerRef}
            // We clip so a field focused in an off-screen column cannot scroll the pager sideways.
            className="relative w-full h-full overflow-clip"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              touchAction: "pan-y",
              willChange: "transform",
            }}
          >
            <div
              className="flex w-full h-full"
              inert={!!page}
              aria-hidden={!!page || undefined}
              style={{
                transform: `translateX(calc(-${currentPageIndex * 100}% + ${offset}px))`,
                transition: isTransitioning
                  ? "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
                  : "none",
              }}
            >
              {PAGE_ORDER.filter(
                (col) => col !== "memberList" || hasMemberPage,
              ).map((column) => (
                <div
                  key={column}
                  className="w-full h-full flex-shrink-0"
                  data-swipe-page={column}
                >
                  {getLayoutColumnElement(column)}
                </div>
              ))}
            </div>
            {page && <PageLayer page={page} />}
          </div>
        ) : (
          <>
            {getLayoutColumn("serverList")}
            {getLayoutColumn("chatView")}
            {(selectedServerId || sidePane?.kind === "search") &&
              getLayoutColumn("memberList")}
          </>
        )}
        <GlobalNotifications />
        <VoicePipOverlay />
        {/* Rendered here so window resizes never unmount it */}
        <MediaViewerModal
          isOpen={!!openedMedia}
          url={openedMedia?.url ?? ""}
          sourceMsgId={openedMedia?.sourceMsgId}
          onClose={closeMedia}
          serverId={openedMedia?.serverId}
          channelId={openedMedia?.channelId}
          preferTopicEntry={openedMedia?.preferTopicEntry}
          preferLastEntry={openedMedia?.preferLastEntry}
          decryptedType={openedMedia?.decryptedType}
        />
        <LinkHoverLayer />
        <TitleTooltipLayer />
      </div>
    </ChannelLinkProvider>
  );
};

export default AppLayout;
