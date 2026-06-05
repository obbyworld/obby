import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation";
import { isTauriAndroid } from "../../lib/platformUtils";
import useStore from "../../store";
import type { layoutColumn } from "../../store/types";
import { GlobalNotifications } from "../ui/GlobalNotifications";
import { MediaViewerModal } from "../ui/MediaViewerModal";
import RawLogViewer from "../ui/RawLogViewer";
import { ChannelList } from "./ChannelList";
import { ChatArea } from "./ChatArea";
import { MemberList } from "./MemberList";
import { ResizableSidebar } from "./ResizableSidebar";
import { ServerList } from "./ServerList";
import { VoiceChannelView } from "./VoiceChannelView";

const PAGE_ORDER: layoutColumn[] = ["serverList", "chatView", "memberList"];
const getPageIndex = (column: layoutColumn): number =>
  PAGE_ORDER.indexOf(column);
const getColumnFromPage = (page: number): layoutColumn => PAGE_ORDER[page];

export const AppLayout: React.FC = () => {
  const {
    ui,
    toggleMobileMenu,
    toggleMemberList,
    toggleChannelList,
    setMobileViewActiveColumn,
    setIsNarrowView,
    closeMedia,
  } = useStore();

  const [channelListWidth, setChannelListWidth] = useState<number>(
    ui.sidebarPreferences?.channelList.width ?? 264,
  );
  const [memberListWidth, setMemberListWidth] = useState<number>(
    ui.sidebarPreferences?.memberList.width ?? 280,
  );

  const selectedServerId = ui.selectedServerId;
  const currentSelection = ui.perServerSelections[selectedServerId || ""] || {
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
  const {
    isDarkMode,
    isMobileMenuOpen,
    isMemberListVisible,
    isChannelListVisible,
    mobileViewActiveColumn,
  } = ui;

  // Hide member list for private chats and voice channels (voice has its own grid)
  const shouldShowMemberList =
    isMemberListVisible && !selectedPrivateChatId && !isVoiceChannel;

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
  const isNarrowView = ui.isNarrowView;

  // Desktop narrow: member list shows as overlay in ChatArea instead of sidebar
  const showMemberListAsOverlay = !isNarrowView && isTooNarrowForMemberList;
  const shouldShowMemberListSidebar =
    shouldShowMemberList && !showMemberListAsOverlay;

  // Member list page doesn't exist in DMs — only channels have a member list.
  const hasMemberPage = !!selectedServerId && !selectedPrivateChatId;

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

  const openRawLogViewer = useStore((s) => s.openRawLogViewer);
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
          openRawLogViewer(targetServerId);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openRawLogViewer]);

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
                <div className="w-[72px] flex-shrink-0 h-full bg-discord-dark-300 select-none">
                  <ServerList />
                </div>
              )}
              <div className="w-[calc(100vw-72px)] h-full bg-discord-dark-100">
                <ChannelList
                  onToggle={() => toggleChannelList(!isChannelListVisible)}
                />
              </div>
            </div>
          );
        }
        return (
          <>
            {__HIDE_SERVER_LIST__ ? null : (
              <div className="server-list flex-shrink-0 h-full bg-discord-dark-300 z-30 w-[72px] select-none">
                <ServerList />
              </div>
            )}
            <ResizableSidebar
              bypass={false}
              isVisible={isChannelListVisible}
              defaultWidth={264}
              initialWidth={channelListWidth}
              minWidth={80}
              maxWidth={400}
              side="left"
              onMinReached={() => toggleChannelList(false)}
              onWidthChange={handleChannelListWidthChange}
            >
              <div className="channel-list w-full h-full bg-discord-dark-100 md:block z-20">
                <ChannelList
                  onToggle={() => toggleChannelList(!isChannelListVisible)}
                />
              </div>
            </ResizableSidebar>
          </>
        );
      case "chatView":
        return (
          <div
            className={`${isNarrowView ? "w-full" : "flex-grow"} h-full bg-discord-dark-200 flex flex-col min-w-0 z-10`}
          >
            {(() => {
              // Both `^` (voice) and `$` (stream) channels render through
              // ChatArea with the VoiceChannelView injected as a topSlot,
              // so the channel's ChatHeader stays at the very top of the
              // panel and the voice grid + chat live beneath it as one
              // continuous column.
              const voiceTopSlot =
                isVoiceChannel && selectedServerId && selectedChannel ? (
                  <VoiceChannelView
                    serverId={selectedServerId}
                    channelName={selectedChannel.name}
                  />
                ) : undefined;
              return (
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
              );
            })()}
          </div>
        );
      case "memberList":
        if (isNarrowView) {
          return (
            <div className="w-full h-full bg-discord-dark-100">
              <MemberList />
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
              <MemberList />
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

  // Handle mobile back button
  // TODO: ios
  if (isTauriAndroid()) {
    window.androidBackCallback = () => {
      switch (mobileViewActiveColumn) {
        case "chatView":
          setMobileViewActiveColumn("serverList");
          toggleChannelList(true);
          return false; // the android back will be prevented
        case "memberList":
          setMobileViewActiveColumn("chatView");
          toggleMemberList(false);
          return false; // the android back will be prevented
        default:
          return true; // the default android back
      }
    };
  }

  return (
    <div
      className={`flex h-full overflow-hidden bg-discord-dark-300 keyboard-aware-layout ${
        isDarkMode ? "text-white" : "text-gray-900"
      }`}
      style={{
        paddingTop: "var(--safe-area-inset-top)",
        paddingRight: "var(--safe-area-inset-right)",
        paddingBottom: "var(--safe-area-inset-bottom)",
        paddingLeft: "var(--safe-area-inset-left)",
      }}
    >
      {isNarrowView ? (
        <div
          ref={containerRef}
          className="relative w-full h-full overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            touchAction: "pan-y",
            willChange: "transform",
          }}
        >
          <div
            className="flex h-full"
            style={{
              transform: `translateX(calc(-${currentPageIndex * 100}vw + ${offset}px))`,
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
                className="h-full flex-shrink-0"
                style={{ width: "100vw" }}
                data-swipe-page={column}
              >
                {getLayoutColumnElement(column)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {getLayoutColumn("serverList")}
          {getLayoutColumn("chatView")}
          {selectedServerId && getLayoutColumn("memberList")}
        </>
      )}
      <GlobalNotifications />
      {/* Rendered here so window resizes never unmount it */}
      <MediaViewerModal
        isOpen={!!ui.openedMedia}
        url={ui.openedMedia?.url ?? ""}
        sourceMsgId={ui.openedMedia?.sourceMsgId}
        onClose={closeMedia}
        serverId={ui.openedMedia?.serverId}
        channelId={ui.openedMedia?.channelId}
        preferTopicEntry={ui.openedMedia?.preferTopicEntry}
        preferLastEntry={ui.openedMedia?.preferLastEntry}
      />
      <RawLogViewer />
    </div>
  );
};

export default AppLayout;
