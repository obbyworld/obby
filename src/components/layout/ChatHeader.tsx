import { UsersIcon } from "@heroicons/react/24/solid";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaBell,
  FaBellSlash,
  FaCheckCircle,
  FaChevronLeft,
  FaChevronRight,
  FaDesktop,
  FaEllipsisV,
  FaFilm,
  FaHashtag,
  FaInfoCircle,
  FaList,
  FaMicrophone,
  FaPenAlt,
  FaSearch,
  FaThumbtack,
  FaTimes,
  FaUser,
  FaUserPlus,
} from "react-icons/fa";
import {
  getChannelAvatarUrl,
  getChannelDisplayName,
  serverFilehosts,
} from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { isTauriMobile } from "../../lib/platformUtils";
import useStore, { loadSavedMetadata } from "../../store";
import type { Channel, PrivateChat, User } from "../../types";
import HeaderOverflowMenu, {
  type HeaderOverflowMenuItem,
} from "../ui/HeaderOverflowMenu";
import { TextInput } from "../ui/TextInput";
import TopicModal from "../ui/TopicModal";

interface ChatHeaderProps {
  selectedChannel: Channel | null;
  selectedPrivateChat: PrivateChat | null;
  selectedServerId: string | null;
  selectedChannelId: string | null;
  currentUser: User | null;
  isChanListVisible: boolean;
  isMemberListVisible: boolean;
  isNarrowView: boolean;
  globalSettings: {
    notificationVolume: number;
  };
  searchQuery: string;
  onToggleChanList: () => void;
  onToggleMemberList: () => void;
  onSearchQueryChange: (query: string) => void;
  onToggleNotificationVolume: () => void;
  onOpenChannelSettings: () => void;
  onOpenInviteUser: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  selectedChannel,
  selectedPrivateChat,
  selectedServerId,
  selectedChannelId,
  currentUser,
  isChanListVisible,
  isMemberListVisible,
  isNarrowView,
  globalSettings,
  searchQuery,
  onToggleChanList,
  onToggleMemberList,
  onSearchQueryChange,
  onToggleNotificationVolume,
  onOpenChannelSettings,
  onOpenInviteUser,
}) => {
  const { t } = useLingui();
  const {
    toggleChannelListModal,
    toggleMemberList,
    setMobileViewActiveColumn,
    pinPrivateChat,
    unpinPrivateChat,
    setTopicModalRequest,
    clearTopicModalRequest,
    setProfileViewRequest,
    toggleUserProfileModal,
    openMediaExplorer,
  } = useStore();
  const ui = useStore((state) => state.ui);
  const topicModalRequest = useStore((state) => state.ui.topicModalRequest);
  const profileViewRequest = useStore((state) => state.ui.profileViewRequest);
  const nativeMobile = isTauriMobile();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);

  const servers = useStore((state) => state.servers);
  const mobileViewActiveColumn = useStore(
    (state) => state.ui.mobileViewActiveColumn,
  );

  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );

  // Get private chat user metadata - first check localStorage, then check shared channels
  const privateChatUserMetadata = useMemo(() => {
    if (!selectedPrivateChat || !selectedServerId) return null;

    // First check localStorage for saved metadata
    const savedMetadata = loadSavedMetadata();
    const serverMetadata = savedMetadata[selectedServerId];
    if (serverMetadata?.[selectedPrivateChat.username]) {
      return serverMetadata[selectedPrivateChat.username];
    }

    // If not in localStorage, check if user is in any shared channels
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return null;

    // Search through all channels for this user
    for (const channel of server.channels) {
      const user = channel.users.find(
        (u) =>
          u.username.toLowerCase() ===
          selectedPrivateChat.username.toLowerCase(),
      );
      if (user?.metadata && Object.keys(user.metadata).length > 0) {
        return user.metadata;
      }
    }

    return null;
  }, [selectedPrivateChat, selectedServerId, servers]);

  // Helper function to get user metadata
  const getUserMetadata = (username: string) => {
    if (!selectedServerId) return null;

    // First check localStorage for saved metadata
    const savedMetadata = loadSavedMetadata();
    const serverMetadata = savedMetadata[selectedServerId];
    if (serverMetadata?.[username]) {
      return serverMetadata[username];
    }

    // If not in localStorage, check if user is in any shared channels
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return null;

    // Search through all channels for this user
    for (const channel of server.channels) {
      const user = channel.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase(),
      );
      if (user?.metadata && Object.keys(user.metadata).length > 0) {
        return user.metadata;
      }
    }

    return null;
  };

  // Helper function to get full user object from shared channels
  const getUserFromChannels = (username: string) => {
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return null;

    // Search through all channels for this user
    for (const channel of server.channels) {
      const user = channel.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase(),
      );
      if (user) {
        return user;
      }
    }

    return null;
  };

  // Helper function to render verification and bot badges
  const renderUserBadges = (
    username: string,
    privateChat: PrivateChat | undefined,
    user: User | null,
    showVerified = true,
  ) => {
    // Get account and bot info from privateChat first, fall back to channel user
    const account = privateChat?.account || user?.account;
    const isBot =
      privateChat?.isBot ||
      user?.isBot ||
      user?.metadata?.bot?.value === "true";
    const isIrcOp = user?.isIrcOp || false;

    const isVerified =
      showVerified &&
      account &&
      account !== "0" &&
      username.toLowerCase() === account.toLowerCase();

    if (!isVerified && !isBot && !isIrcOp) return null;

    return (
      <>
        {isVerified && (
          <FaCheckCircle
            className="inline ml-0.5 text-green-500"
            style={{ fontSize: "0.75em", verticalAlign: "baseline" }}
            title={t`Verified account`}
          />
        )}
        {isBot && (
          <span
            className="inline ml-0.5"
            style={{ fontSize: "0.9em" }}
            title={t`Bot`}
          >
            🤖
          </span>
        )}
        {isIrcOp && (
          <span
            className="inline ml-0.5"
            style={{ fontSize: "0.9em" }}
            title={t`IRC Operator`}
          >
            🔑
          </span>
        )}
      </>
    );
  };

  const privateChatAvatar = privateChatUserMetadata?.avatar?.value;

  // Check if current user is operator
  const isOperator = useMemo(() => {
    if (!selectedChannel || !selectedServerId) return false;
    const selectedServer = servers.find((s) => s.id === selectedServerId);
    if (!selectedServer) return false;

    const channelUser = selectedChannel.users.find(
      (u) => u.username === currentUser?.username,
    );
    return (
      channelUser?.status?.includes("@") || channelUser?.status?.includes("~")
    );
  }, [selectedChannel, selectedServerId, servers, currentUser]);

  // Quick check: does this chat have any messages with URLs?
  // Used to show/hide the media explorer button.
  // DMs use privateChatId as the message key (selectedChannelId is null for DMs).
  const hasMediaInMessages = useStore((state) => {
    if (!selectedServerId) return false;
    const chatId = selectedChannelId ?? selectedPrivateChat?.id ?? null;
    if (!chatId) return false;
    const key = `${selectedServerId}-${chatId}`;
    return (state.messages[key] ?? []).some((m) => m.content.includes("http"));
  });
  const hasMedia =
    hasMediaInMessages || Boolean(selectedChannel?.topic?.includes("http"));

  // Reset search expanded state and overflow menu when channel or mobile view changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: Need to reset when channel or page changes
  useEffect(() => {
    setIsSearchExpanded(false);
    setIsOverflowMenuOpen(false);
  }, [selectedChannelId, mobileViewActiveColumn]);

  // Minimal header for blank page (server selected but no channel) or home page
  if (
    !selectedChannel &&
    !selectedPrivateChat &&
    selectedChannelId !== "server-notices"
  ) {
    const title = selectedServerId ? t`Select a channel` : t`Home`;
    return (
      <div className="px-4 py-2.5 border-b border-discord-dark-400 shadow-sm flex items-center min-h-12">
        {(isNarrowView || !isChanListVisible) && (
          <button
            onClick={onToggleChanList}
            className="p-2 md:p-0 text-discord-channels-default hover:text-white flex-shrink-0"
            aria-label={t`Expand channel list`}
          >
            {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
          </button>
        )}
        <h2 className="ml-4 font-bold text-white">{title}</h2>
      </div>
    );
  }

  // Define overflow menu items based on context
  const overflowMenuItems: HeaderOverflowMenuItem[] = [
    {
      label: t`Media`,
      icon: <FaFilm />,
      onClick: () => {
        if (selectedServerId && selectedChannelId) {
          openMediaExplorer(selectedServerId, selectedChannelId);
        }
      },
      show: hasMedia,
    },
    {
      label: t`Channel Settings`,
      icon: <FaPenAlt />,
      onClick: onOpenChannelSettings,
      show: !!selectedChannel,
    },
    {
      label: t`Invite User`,
      icon: <FaUserPlus />,
      onClick: onOpenInviteUser,
      show: !!selectedChannel,
    },
    {
      label: "Play Tic-Tac-Toe",
      icon: <span aria-hidden="true">🎮</span>,
      onClick: () => {
        if (selectedServerId && selectedPrivateChat) {
          useStore
            .getState()
            .tictactoeInvite(selectedServerId, selectedPrivateChat.username);
        }
      },
      show: !!selectedPrivateChat,
    },
    {
      label: t`Server Channels`,
      icon: <FaList />,
      onClick: () => toggleChannelListModal(true),
      show: true,
    },
  ].filter((item) => item.show);

  return (
    <div className="pl-4 pr-0 md:px-4 border-b border-discord-dark-400 shadow-sm flex items-center min-h-12 relative">
      {/* Full-width search overlay (narrow view only) */}
      {isSearchExpanded && (selectedChannel || selectedPrivateChat) && (
        <div className="md:hidden absolute inset-0 z-10 flex items-center gap-2 px-2 bg-discord-dark-500">
          {selectedChannel ? (
            selectedChannel.name.startsWith("^") ? (
              <FaMicrophone className="text-discord-text-muted text-lg flex-shrink-0" />
            ) : selectedChannel.name.startsWith("$") ? (
              <FaDesktop className="text-discord-text-muted text-lg flex-shrink-0" />
            ) : (
              <FaHashtag className="text-discord-text-muted text-lg flex-shrink-0" />
            )
          ) : (
            <FaUser className="text-discord-text-muted text-lg flex-shrink-0" />
          )}
          <TextInput
            autoFocus
            placeholder={t`Search messages…`}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsSearchExpanded(false);
                onSearchQueryChange("");
              }
            }}
            className="flex-1 bg-discord-dark-400 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-text-link min-w-0"
          />
          <button
            className="p-2 text-discord-text-muted hover:text-white flex-shrink-0"
            onClick={() => {
              if (searchQuery) {
                onSearchQueryChange("");
              } else {
                // Blur before closing so iOS WKWebView fires will-hide and clears
                // root.style.position/bottom and data-keyboard-visible properly.
                // Without this, onMouseDown's preventDefault keeps focus on the input,
                // the unmount doesn't trigger the native keyboard dismiss sequence,
                // and data-keyboard-visible stays set — blocking all swipe gestures.
                (document.activeElement as HTMLElement)?.blur();
                setIsSearchExpanded(false);
              }
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <FaTimes />
          </button>
        </div>
      )}
      {/* CHANNELS */}
      {selectedChannel && (
        <div className="flex items-center justify-between w-full gap-2">
          {/* Left: Back button */}
          {(isNarrowView || !isChanListVisible) && (
            <button
              onClick={onToggleChanList}
              className="p-2 md:p-0 text-discord-channels-default hover:text-white flex-shrink-0"
              aria-label={t`Expand channel list`}
            >
              {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
            </button>
          )}

          {/* Avatar/Hash - spans 2 rows */}
          <div className="flex-shrink-0 mr-2">
            {(() => {
              const avatarUrl = getChannelAvatarUrl(
                selectedChannel.metadata,
                50,
              );
              const selectedServer = servers.find(
                (s) => s.id === selectedServerId,
              );
              const shouldShowAvatar = canShowAvatarUrl(
                avatarUrl,
                serverFilehosts(selectedServer),
                mediaSettings,
              );

              return shouldShowAvatar ? (
                <img
                  src={avatarUrl}
                  alt={selectedChannel.name}
                  className="w-10 h-10 rounded-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const parent = e.currentTarget.parentElement;
                    const fallbackIcon = parent?.querySelector(
                      ".fallback-hash-icon",
                    );
                    if (fallbackIcon) {
                      (fallbackIcon as HTMLElement).style.display =
                        "inline-block";
                    }
                  }}
                />
              ) : null;
            })()}
            {(() => {
              const ChannelIcon = selectedChannel.name.startsWith("^")
                ? FaMicrophone
                : selectedChannel.name.startsWith("$")
                  ? FaDesktop
                  : FaHashtag;
              return (
                <ChannelIcon
                  className="text-discord-text-muted fallback-hash-icon flex-shrink-0 text-3xl"
                  style={{
                    display: (() => {
                      const avatarUrl = getChannelAvatarUrl(
                        selectedChannel.metadata,
                        50,
                      );
                      const selectedServer = servers.find(
                        (s) => s.id === selectedServerId,
                      );
                      return canShowAvatarUrl(
                        avatarUrl,
                        serverFilehosts(selectedServer),
                        mediaSettings,
                      )
                        ? "none"
                        : "inline-block";
                    })(),
                  }}
                />
              );
            })()}
          </div>

          {/* Center: Title and Topic stacked */}
          <div className="flex flex-col justify-center min-w-0 flex-1">
            {/* Title */}
            <h2 className="font-bold text-white truncate">
              {getChannelDisplayName(
                selectedChannel.name,
                selectedChannel.metadata,
              )}
            </h2>

            {/* Topic text, or placeholder for ops when topic is empty */}
            {selectedChannel.topic ? (
              <button
                onClick={() => {
                  if (selectedServerId && selectedChannel.id) {
                    setTopicModalRequest(selectedServerId, selectedChannel.id);
                  }
                }}
                className="text-discord-text-muted text-xs hover:text-white truncate text-left"
                title={selectedChannel.topic}
              >
                {selectedChannel.topic}
              </button>
            ) : isOperator ? (
              <button
                onClick={() => {
                  if (selectedServerId && selectedChannel.id) {
                    setTopicModalRequest(selectedServerId, selectedChannel.id);
                  }
                }}
                className="text-discord-channels-default/40 text-xs hover:text-discord-channels-default truncate text-left italic"
              >
                <Trans>Click to set topic</Trans>
              </button>
            ) : null}
          </div>

          {/* Right: Action buttons */}
          {selectedServerId && (
            <div className="flex items-center gap-0 md:gap-3 text-discord-text-muted flex-shrink-0">
              {/* Bell */}
              <button
                className="p-2 md:p-0 hover:text-discord-text-normal"
                onClick={onToggleNotificationVolume}
                aria-label={
                  globalSettings.notificationVolume > 0
                    ? t`Mute notifications`
                    : t`Enable notifications`
                }
                title={
                  globalSettings.notificationVolume > 0
                    ? t`Mute notifications`
                    : t`Enable notifications`
                }
              >
                {globalSettings.notificationVolume > 0 ? (
                  <FaBell />
                ) : (
                  <FaBellSlash />
                )}
              </button>

              {/* Users — hidden on iOS/Android native since member list is a swipe-right gesture */}
              {!nativeMobile && (
                <button
                  className="p-2 md:p-0 hover:text-discord-text-normal"
                  onClick={() => {
                    if (isNarrowView) {
                      const currentColumn =
                        useStore.getState().ui.mobileViewActiveColumn;
                      const isOnMemberPage = currentColumn === "memberList";

                      if (isOnMemberPage) {
                        setMobileViewActiveColumn("chatView");
                      } else {
                        setMobileViewActiveColumn("memberList");
                      }
                    } else {
                      toggleMemberList(!isMemberListVisible);
                    }
                  }}
                  aria-label={
                    isMemberListVisible
                      ? t`Collapse member list`
                      : t`Expand member list`
                  }
                  data-testid="toggle-member-list"
                >
                  {(
                    isNarrowView
                      ? mobileViewActiveColumn === "memberList"
                      : isMemberListVisible
                  ) ? (
                    <UsersIcon className="w-4 h-4 text-white" />
                  ) : (
                    <UsersIcon className="w-4 h-4 text-gray" />
                  )}
                </button>
              )}

              {/* Desktop action buttons */}
              <button
                className="hidden md:block hover:text-discord-text-normal"
                onClick={onOpenChannelSettings}
                title={t`Channel Settings`}
              >
                <FaPenAlt />
              </button>
              <button
                className="hidden md:block hover:text-discord-text-normal"
                onClick={onOpenInviteUser}
                title={t`Invite User`}
              >
                <FaUserPlus />
              </button>
              <button
                className="hidden md:block hover:text-discord-text-normal"
                onClick={() => toggleChannelListModal(true)}
                title={t`Server Channels`}
              >
                <FaList />
              </button>
              {/* Media explorer — in overflow menu on native mobile, inline button elsewhere */}
              {hasMedia && !nativeMobile && (
                <button
                  className="p-2 md:p-0 hover:text-discord-text-normal"
                  onClick={() => {
                    if (selectedServerId && selectedChannelId) {
                      openMediaExplorer(selectedServerId, selectedChannelId);
                    }
                  }}
                  title={t`Media`}
                >
                  <FaFilm />
                </button>
              )}
              {/* Search */}
              <button
                className="md:hidden p-2 hover:text-discord-text-normal"
                onClick={() => setIsSearchExpanded(!isSearchExpanded)}
                aria-label={t`Toggle search`}
                title={t`Search`}
              >
                <FaSearch />
              </button>

              <div className="hidden md:block relative">
                <TextInput
                  placeholder={t`Search`}
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="bg-discord-dark-400 text-discord-text-muted text-sm rounded px-2 py-1 pr-14 w-32 focus:outline-none focus:ring-1 focus:ring-discord-text-link"
                />
                {searchQuery && (
                  <button
                    className="absolute right-6 top-1.5 text-red-400 hover:text-red-300 text-xs"
                    onClick={() => onSearchQueryChange("")}
                    title={t`Clear search`}
                  >
                    <FaTimes />
                  </button>
                )}
                <FaSearch className="absolute right-2 top-1.5 text-xs" />
              </div>

              {/* Overflow menu */}
              <button
                ref={overflowButtonRef}
                className="md:hidden p-2 hover:text-discord-text-normal"
                onClick={() => setIsOverflowMenuOpen(!isOverflowMenuOpen)}
                aria-label={t`More actions`}
                aria-expanded={isOverflowMenuOpen}
                title={t`More`}
              >
                <FaEllipsisV />
              </button>
            </div>
          )}
        </div>
      )}

      {/* PRIVATE CHATS */}
      {selectedPrivateChat && (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center min-w-0 flex-1 gap-3">
            {(isNarrowView || !isChanListVisible) && (
              <button
                onClick={onToggleChanList}
                className="p-2 md:p-0 text-discord-channels-default hover:text-white mr-4 flex-shrink-0"
                aria-label={t`Expand channel list`}
              >
                {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
              </button>
            )}
            <div className="relative w-10 h-10 flex-shrink-0">
              {(() => {
                const selectedServer = servers.find(
                  (s) => s.id === selectedServerId,
                );
                const shouldShowAvatar =
                  canShowAvatarUrl(
                    privateChatAvatar,
                    serverFilehosts(selectedServer),
                    mediaSettings,
                  ) && !avatarLoadFailed;

                return shouldShowAvatar ? (
                  <img
                    src={privateChatAvatar}
                    alt={selectedPrivateChat.username}
                    className="w-full h-full rounded-full object-cover"
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-discord-dark-400 flex items-center justify-center">
                    <FaUser className="text-discord-text-muted text-xl" />
                  </div>
                );
              })()}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-dark-200 ${
                  selectedPrivateChat.isOnline
                    ? selectedPrivateChat.isAway
                      ? "bg-yellow-500"
                      : "bg-green-500"
                    : "bg-gray-500"
                }`}
                title={
                  selectedPrivateChat.isOnline
                    ? selectedPrivateChat.isAway
                      ? t`Away`
                      : t`Online`
                    : t`Offline`
                }
              />
            </div>
            <div className="flex flex-col">
              <h2 className="font-bold text-white">
                {(() => {
                  const userMetadata = getUserMetadata(
                    selectedPrivateChat.username,
                  );
                  const displayName = userMetadata?.["display-name"]?.value;
                  const user = getUserFromChannels(
                    selectedPrivateChat.username,
                  );
                  return (
                    <>
                      {displayName || selectedPrivateChat.username}
                      {renderUserBadges(
                        selectedPrivateChat.username,
                        selectedPrivateChat,
                        user,
                        !displayName,
                      )}
                    </>
                  );
                })()}
              </h2>
              {(() => {
                const userMetadata = getUserMetadata(
                  selectedPrivateChat.username,
                );
                const displayName = userMetadata?.["display-name"]?.value;
                const user = getUserFromChannels(selectedPrivateChat.username);

                if (displayName) {
                  return (
                    <div className="flex items-center gap-1.5 text-xs truncate mt-0.5">
                      <span className="bg-gray-300 text-black px-1 py-0 rounded font-bold whitespace-nowrap text-[10px]">
                        {selectedPrivateChat.username}
                        {renderUserBadges(
                          selectedPrivateChat.username,
                          selectedPrivateChat,
                          user,
                        )}
                      </span>
                    </div>
                  );
                }

                return privateChatUserMetadata?.status?.value ? (
                  <span className="text-xs text-discord-text-muted">
                    {privateChatUserMetadata.status.value}
                  </span>
                ) : null;
              })()}
            </div>
            {selectedServerId && (
              <button
                className={`ml-2 ${
                  selectedPrivateChat.isPinned
                    ? "text-green-500 hover:text-green-400"
                    : "text-discord-text-muted hover:text-yellow-400"
                }`}
                onClick={() => {
                  if (selectedPrivateChat.isPinned) {
                    unpinPrivateChat(selectedServerId, selectedPrivateChat.id);
                  } else {
                    pinPrivateChat(selectedServerId, selectedPrivateChat.id);
                  }
                }}
                title={selectedPrivateChat.isPinned ? t`Unpin` : t`Pin`}
              >
                <FaThumbtack
                  className={
                    selectedPrivateChat.isPinned ? "" : "rotate-[25deg]"
                  }
                  style={
                    selectedPrivateChat.isPinned
                      ? {}
                      : { transform: "rotate(25deg)" }
                  }
                />
              </button>
            )}
            {selectedServerId && (
              <button
                className="ml-2 text-discord-text-muted hover:text-white"
                onClick={() => {
                  if (selectedServerId && selectedPrivateChat) {
                    setProfileViewRequest(
                      selectedServerId,
                      selectedPrivateChat.username,
                    );
                    toggleUserProfileModal(true);
                  }
                }}
                title={t`User Profile`}
              >
                <FaInfoCircle />
              </button>
            )}
          </div>

          {selectedServerId && (
            <div className="flex items-center gap-0 md:gap-4 text-discord-text-muted flex-shrink-0">
              <button
                className="p-2 md:p-0 hover:text-discord-text-normal"
                onClick={onToggleNotificationVolume}
                aria-label={
                  globalSettings.notificationVolume > 0
                    ? t`Mute notifications`
                    : t`Enable notifications`
                }
                title={
                  globalSettings.notificationVolume > 0
                    ? t`Mute notifications`
                    : t`Enable notifications`
                }
              >
                {globalSettings.notificationVolume > 0 ? (
                  <FaBell />
                ) : (
                  <FaBellSlash />
                )}
              </button>

              {hasMedia && !nativeMobile && (
                <button
                  className="p-2 md:p-0 hover:text-discord-text-normal"
                  onClick={() => {
                    const chatId = selectedPrivateChat?.id ?? null;
                    if (selectedServerId && chatId) {
                      openMediaExplorer(selectedServerId, chatId);
                    }
                  }}
                  title={t`Media`}
                >
                  <FaFilm />
                </button>
              )}
              <button
                className="p-2 md:p-0 hover:text-discord-text-normal"
                onClick={() => {
                  if (selectedServerId && selectedPrivateChat) {
                    useStore
                      .getState()
                      .tictactoeInvite(
                        selectedServerId,
                        selectedPrivateChat.username,
                      );
                  }
                }}
                aria-label="Play Tic-Tac-Toe"
                title="Play Tic-Tac-Toe"
              >
                <span aria-hidden="true">🎮</span>
              </button>
              <button
                className="md:hidden p-2 hover:text-discord-text-normal"
                onClick={() => setIsSearchExpanded(!isSearchExpanded)}
                aria-label={t`Toggle search`}
                title={t`Search`}
              >
                <FaSearch />
              </button>

              <div className="hidden md:block relative">
                <TextInput
                  placeholder={t`Search`}
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="bg-discord-dark-400 text-discord-text-muted text-sm rounded px-2 py-1 pr-14 w-32 focus:outline-none focus:ring-1 focus:ring-discord-text-link"
                />
                {searchQuery && (
                  <button
                    className="absolute right-6 top-1.5 text-red-400 hover:text-red-300 text-xs"
                    onClick={() => onSearchQueryChange("")}
                    title={t`Clear search`}
                  >
                    <FaTimes />
                  </button>
                )}
                <FaSearch className="absolute right-2 top-1.5 text-xs" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* SERVER NOTICES */}
      {selectedChannelId === "server-notices" && (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center min-w-0 flex-1">
            {(isNarrowView || !isChanListVisible) && (
              <button
                onClick={onToggleChanList}
                className="p-2 md:p-0 text-discord-channels-default hover:text-white mr-4 flex-shrink-0"
                aria-label={t`Expand channel list`}
              >
                {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
              </button>
            )}
            <FaList className="text-discord-text-muted mr-2" />
            <h2 className="font-bold text-white mr-4">
              <Trans>Server Notices</Trans>
            </h2>
          </div>
        </div>
      )}

      {/* Overflow Menu Component */}
      <HeaderOverflowMenu
        isOpen={isOverflowMenuOpen}
        onClose={() => setIsOverflowMenuOpen(false)}
        menuItems={overflowMenuItems}
        anchorElement={overflowButtonRef.current}
      />

      {/* Topic Modal */}
      {topicModalRequest &&
        (() => {
          const channel = servers
            .find((s) => s.id === topicModalRequest.serverId)
            ?.channels.find((c) => c.id === topicModalRequest.channelId);
          return channel ? (
            <TopicModal
              isOpen={true}
              onClose={() => clearTopicModalRequest()}
              channel={channel}
              serverId={topicModalRequest.serverId}
              currentUser={currentUser}
            />
          ) : null;
        })()}
    </div>
  );
};
