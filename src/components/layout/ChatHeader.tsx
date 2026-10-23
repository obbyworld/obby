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
  FaRobot,
  FaSearch,
  FaThumbtack,
  FaUser,
  FaUserPlus,
} from "react-icons/fa";
import { useShallow } from "zustand/react/shallow";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import {
  getChannelAvatarUrl,
  getChannelDisplayName,
  serverFilehosts,
} from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { isTauriMobile } from "../../lib/platformUtils";
import { currentChatScope } from "../../lib/search/searchScope";
import type { SearchScope } from "../../lib/search/searchTypes";
import useStore, { loadSavedMetadata } from "../../store";
import type { Channel, PrivateChat, User } from "../../types";
import { BotToolsHistoryButton } from "../ui/BotToolsHistoryButton";
import E2EELockControl from "../ui/E2EELockControl";
import Menu, { type MenuItem } from "../ui/Menu";
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
  onToggleChanList: () => void;
  onToggleMemberList: () => void;
  onToggleNotificationVolume: () => void;
  onOpenChannelSettings: () => void;
  onOpenInviteUser: () => void;
  onOpenBots: () => void;
}

const HeaderSearchButton: React.FC<{ scope: SearchScope }> = ({ scope }) => {
  const { t } = useLingui();
  const openQuickActions = useStore((state) => state.openQuickActions);
  const isTouch = useIsTouchInput();
  const label = t`Search messages`;
  const open = () => openQuickActions("messages", scope);
  if (isTouch)
    return (
      <button
        type="button"
        className="w-11 h-11 shrink-0 flex items-center justify-center text-white"
        onClick={open}
        aria-label={label}
        title={label}
      >
        <span className="chip-outline w-8 h-8 justify-center rounded-lg px-0">
          <FaSearch className="text-sm" />
        </span>
      </button>
    );
  return (
    <button
      type="button"
      className="chip-outline h-8"
      onClick={open}
      aria-label={label}
      title={label}
    >
      <FaSearch className="text-xs" />
      <Trans>Search</Trans>
    </button>
  );
};

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
  onToggleChanList,
  onToggleMemberList,
  onToggleNotificationVolume,
  onOpenChannelSettings,
  onOpenInviteUser,
  onOpenBots,
}) => {
  const { t } = useLingui();
  const {
    openPage,
    openProfile,
    toggleMemberList,
    setMobileViewActiveColumn,
    pinPrivateChat,
    unpinPrivateChat,
    setTopicModalRequest,
    clearTopicModalRequest,
    openMediaExplorer,
  } = useStore(
    useShallow((state) => ({
      openPage: state.openPage,
      openProfile: state.openProfile,
      toggleMemberList: state.toggleMemberList,
      setMobileViewActiveColumn: state.setMobileViewActiveColumn,
      pinPrivateChat: state.pinPrivateChat,
      unpinPrivateChat: state.unpinPrivateChat,
      setTopicModalRequest: state.setTopicModalRequest,
      clearTopicModalRequest: state.clearTopicModalRequest,
      openMediaExplorer: state.openMediaExplorer,
    })),
  );
  const ui = useStore((state) => state.ui);
  const topicModalRequest = useStore((state) => state.ui.topicModalRequest);
  const botsLoadingCount = useStore(
    (state) =>
      state.servers.find((s) => s.id === selectedServerId)?.botCommandsLoading
        ?.length ?? 0,
  );
  const nativeMobile = isTauriMobile();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Need to reset when channel or page changes
  useEffect(() => {
    setIsOverflowMenuOpen(false);
  }, [selectedChannelId, mobileViewActiveColumn]);

  // Minimal header for blank page (server selected but no channel) or home page
  if (
    !selectedChannel &&
    !selectedPrivateChat &&
    selectedChannelId !== "server-notices"
  ) {
    const minimalHeaderServer = servers.find((s) => s.id === selectedServerId);
    // The soju bouncer control session has no real channels of its own --
    // we only land here to drive the BouncerNetworksPanel, so call the
    // call-to-action what it actually is.
    const title = selectedServerId
      ? minimalHeaderServer?.isBouncerControl
        ? t`Select a Network`
        : t`Select a channel`
      : t`Home`;
    return (
      <div className="px-4 py-2.5 border-b border-discord-dark-400 shadow-sm flex items-center min-h-12">
        {(isNarrowView || !isChanListVisible) && (
          <button
            onClick={onToggleChanList}
            className="p-3 -m-1 md:p-0 md:m-0 text-discord-channels-default hover:text-white flex-shrink-0"
            aria-label={t`Expand channel list`}
          >
            {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
          </button>
        )}
        <h2 className="ml-4 font-bold text-white">{title}</h2>
      </div>
    );
  }

  const chatScope = currentChatScope(servers, selectedServerId, {
    selectedChannelId: selectedChannel?.id ?? null,
    selectedPrivateChatId: selectedPrivateChat?.id ?? null,
  });

  const memberListToggleLabel = isMemberListVisible
    ? t`Collapse member list`
    : t`Expand member list`;

  const openPrivateChatProfile = () => {
    if (!selectedServerId || !selectedPrivateChat) return;
    openProfile(selectedServerId, selectedPrivateChat.username);
  };

  const overflowMenuItems: MenuItem[] = [
    {
      label: selectedPrivateChat?.isPinned
        ? t`Unpin conversation`
        : t`Pin conversation`,
      icon: <FaThumbtack />,
      onClick: () => {
        if (!selectedServerId || !selectedPrivateChat) return;
        if (selectedPrivateChat.isPinned)
          unpinPrivateChat(selectedServerId, selectedPrivateChat.id);
        else pinPrivateChat(selectedServerId, selectedPrivateChat.id);
      },
      show: !!selectedPrivateChat && !!selectedServerId,
    },
    {
      label: t`See profile`,
      icon: <FaInfoCircle />,
      onClick: openPrivateChatProfile,
      show: !!selectedPrivateChat && !!selectedServerId,
    },
    {
      label: t`Media`,
      icon: <FaFilm />,
      onClick: () => {
        const chatId = selectedChannelId ?? selectedPrivateChat?.id ?? null;
        if (selectedServerId && chatId) {
          openMediaExplorer(selectedServerId, chatId);
        }
      },
      show: hasMedia && nativeMobile,
    },
    {
      label: t`Edit Channel`,
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
      label:
        botsLoadingCount > 0
          ? t`Manage Bots (loading ${botsLoadingCount})`
          : t`Manage Bots`,
      icon: (
        <FaRobot
          className={
            botsLoadingCount > 0 ? "text-blue-500 animate-pulse-bright" : ""
          }
        />
      ),
      onClick: onOpenBots,
      show: !!selectedServerId,
    },
    {
      label: t`Play Tic-Tac-Toe`,
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
      label: t`Browse Channels`,
      icon: <FaList />,
      onClick: () =>
        selectedServerId &&
        openPage({ kind: "channelBrowser", serverId: selectedServerId }),
      show: true,
    },
  ].filter((item) => item.show);

  return (
    <div className="pl-4 pr-0 md:px-4 border-b border-discord-dark-400 shadow-sm flex items-center min-h-12 relative">
      {/* CHANNELS */}
      {selectedChannel && (
        <div className="flex items-center justify-between w-full gap-2">
          {/* Left: Back button */}
          {(isNarrowView || !isChanListVisible) && (
            <button
              onClick={onToggleChanList}
              className="p-3 -m-1 md:p-0 md:m-0 text-discord-channels-default hover:text-white flex-shrink-0"
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
            <h2 className="min-w-0 flex">
              <button
                type="button"
                onClick={onOpenChannelSettings}
                title={
                  isOperator ? t`Edit channel settings` : t`See channel info`
                }
                className="font-bold text-white truncate text-left hover:underline"
              >
                {getChannelDisplayName(
                  selectedChannel.name,
                  selectedChannel.metadata,
                )}
              </button>
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
                <Trans>Set a topic…</Trans>
              </button>
            ) : null}
          </div>

          {/* Right: Action buttons */}
          {selectedServerId && (
            <div className="flex items-center gap-0 md:gap-3 text-discord-text-muted flex-shrink-0">
              <button
                className="p-3 -m-1 md:hidden hover:text-discord-text-normal"
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
                  aria-label={memberListToggleLabel}
                  title={memberListToggleLabel}
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
              {/* AI workflow history — renders nothing when empty */}
              {selectedServerId && (
                <BotToolsHistoryButton
                  serverId={selectedServerId}
                  channel={selectedChannel.name}
                />
              )}
              <HeaderSearchButton scope={chatScope} />

              {/* Overflow menu */}
              <button
                ref={overflowButtonRef}
                className="md:hidden p-3 -m-1 hover:text-discord-text-normal"
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
                className="p-3 -m-1 md:p-0 md:m-0 text-discord-channels-default hover:text-white mr-4 flex-shrink-0"
                aria-label={t`Expand channel list`}
              >
                {isNarrowView ? <FaChevronLeft /> : <FaChevronRight />}
              </button>
            )}
            <button
              type="button"
              className="flex items-center gap-3 min-w-0 text-left"
              onClick={openPrivateChatProfile}
            >
              <span className="block relative w-10 h-10 flex-shrink-0">
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
                    <span className="w-full h-full rounded-full bg-discord-dark-400 flex items-center justify-center">
                      <FaUser className="text-discord-text-muted text-xl" />
                    </span>
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
              </span>
              <span className="flex flex-col min-w-0">
                <span className="block font-bold text-white truncate">
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
                </span>
                {(() => {
                  const userMetadata = getUserMetadata(
                    selectedPrivateChat.username,
                  );
                  const displayName = userMetadata?.["display-name"]?.value;
                  const user = getUserFromChannels(
                    selectedPrivateChat.username,
                  );

                  if (displayName) {
                    return (
                      <span className="flex items-center gap-1.5 text-xs truncate mt-0.5">
                        <span className="bg-gray-300 text-black px-1 py-0 rounded font-bold whitespace-nowrap text-[10px]">
                          {selectedPrivateChat.username}
                          {renderUserBadges(
                            selectedPrivateChat.username,
                            selectedPrivateChat,
                            user,
                          )}
                        </span>
                      </span>
                    );
                  }

                  return privateChatUserMetadata?.status?.value ? (
                    <span className="text-xs text-discord-text-muted">
                      {privateChatUserMetadata.status.value}
                    </span>
                  ) : null;
                })()}
              </span>
            </button>
            {selectedServerId && (
              <span className="text-xs [&_button]:p-0.5 flex items-center">
                <E2EELockControl
                  serverId={selectedServerId}
                  nick={selectedPrivateChat.username}
                />
              </span>
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
              {selectedServerId && (
                <BotToolsHistoryButton
                  serverId={selectedServerId}
                  channel={selectedPrivateChat.username}
                />
              )}
              <HeaderSearchButton scope={chatScope} />
              <button
                ref={overflowButtonRef}
                className="p-2 hover:text-discord-text-normal"
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

      {/* SERVER NOTICES */}
      {selectedChannelId === "server-notices" && (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center min-w-0 flex-1">
            {(isNarrowView || !isChanListVisible) && (
              <button
                onClick={onToggleChanList}
                className="p-3 -m-1 md:p-0 md:m-0 text-discord-channels-default hover:text-white mr-4 flex-shrink-0"
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
      <Menu
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
