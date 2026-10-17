import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaCog,
  FaHashtag,
  FaMicrophone,
  FaSearch,
  FaServer,
  FaTimes,
  FaUser,
} from "react-icons/fa";
import { useJoinAndSelectChannel } from "../../hooks/useJoinAndSelectChannel";
import {
  classifyChannelName,
  voiceDisplayName,
} from "../../lib/channelMentions";
import { fuzzyMatch } from "../../lib/fuzzySearch";
import ircClient from "../../lib/ircClient";
import { toggleNotificationSound } from "../../lib/notificationVolume";
import { settingsRegistry } from "../../lib/settings";
import type { SettingSearchResult } from "../../lib/settings/types";
import useStore from "../../store";
import type { Channel, PrivateChat } from "../../types";
import { buildQuickActionContext } from "./QuickActions/context";
import { getJoinChannelResults } from "./QuickActions/joinChannelResults";
import type {
  QuickActionResult,
  UIActionData,
  UIModalAction,
  UIToggleAction,
} from "./QuickActions/types";
import {
  getUIActionBadge,
  getUIActionIcon,
  getUIActions,
} from "./QuickActions/uiActionConfig";
import { TextInput } from "./TextInput";

const QuickActions: React.FC = () => {
  const {
    servers,
    ui,
    channelList,
    globalSettings,
    currentUser,
    toggleQuickActions,
    toggleSettingsModal,
    setSettingsNavigation,
    selectChannel,
    selectPrivateChat,
    selectServer,
    openPrivateChat,
    requestChatInputFocus,
    toggleMemberList,
    toggleChannelList,
    pinPrivateChat,
    unpinPrivateChat,
    toggleChannelListModal,
    setTopicModalRequest,
    setProfileViewRequest,
    toggleUserProfileModal,
    setChannelSettingsRequest,
    setInviteUserRequest,
    openRawLogViewer,
  } = useStore();

  const { i18n } = useLingui();
  const joinAndSelectChannel = useJoinAndSelectChannel();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    toggleQuickActions(false);
    setSearchQuery("");
    setSelectedIndex(0);
    requestChatInputFocus();
  }, [toggleQuickActions, requestChatInputFocus]);

  const searchResults: QuickActionResult[] = useMemo(() => {
    const query = searchQuery.trim();
    const results: QuickActionResult[] = [];
    const currentServerId = ui.selectedServerId;
    const currentSelection = currentServerId
      ? ui.perServerSelections[currentServerId]
      : null;

    // If no search query, show unread mentions and messages
    if (query.length === 0) {
      servers.forEach((server) => {
        const isCurrentServer = server.id === currentServerId;

        // Add channels with unread mentions or messages (excluding currently selected)
        server.channels.forEach((channel) => {
          const isCurrentlySelected =
            isCurrentServer &&
            currentSelection?.selectedChannelId === channel.id;

          // Skip currently selected channel
          if (isCurrentlySelected) return;

          // Only show channels with unread mentions or messages
          if (channel.isMentioned && channel.unreadCount > 0) {
            // High priority for mentions (score: 1000 + unreadCount)
            results.push({
              type: "channel",
              id: `channel-${server.id}-${channel.id}`,
              title: voiceDisplayName(channel.name),
              description: `${server.name}${channel.topic ? ` - ${channel.topic}` : ""}`,
              serverId: server.id,
              score: 1000 + channel.unreadCount,
              data: channel,
            });
          } else if (channel.unreadCount > 0) {
            // Lower priority for unread messages (score: 500 + unreadCount)
            results.push({
              type: "channel",
              id: `channel-${server.id}-${channel.id}`,
              title: voiceDisplayName(channel.name),
              description: `${server.name}${channel.topic ? ` - ${channel.topic}` : ""}`,
              serverId: server.id,
              score: 500 + channel.unreadCount,
              data: channel,
            });
          }
        });

        // Add private chats with unread mentions or messages (excluding currently selected)
        server.privateChats.forEach((pm) => {
          const isCurrentlySelected =
            isCurrentServer &&
            currentSelection?.selectedPrivateChatId === pm.id;

          // Skip currently selected PM
          if (isCurrentlySelected) return;

          // Only show PMs with unread mentions or messages
          if (pm.isMentioned && pm.unreadCount > 0) {
            // High priority for mentions (score: 1000 + unreadCount)
            results.push({
              type: "dm",
              id: `dm-${server.id}-${pm.id}`,
              title: pm.username,
              description: server.name,
              serverId: server.id,
              score: 1000 + pm.unreadCount,
              data: pm,
            });
          } else if (pm.unreadCount > 0) {
            // Lower priority for unread messages (score: 500 + unreadCount)
            results.push({
              type: "dm",
              id: `dm-${server.id}-${pm.id}`,
              title: pm.username,
              description: server.name,
              serverId: server.id,
              score: 500 + pm.unreadCount,
              data: pm,
            });
          }
        });

        // Add servers with mentions (excluding currently selected)
        const hasMentions =
          server.channels.some((ch) => ch.isMentioned) ||
          server.privateChats?.some((pc) => pc.isMentioned);
        const isCurrentlySelectedServer = server.id === currentServerId;

        if (hasMentions && !isCurrentlySelectedServer) {
          // Count total mentions in server
          const totalMentions =
            server.channels
              .filter((ch) => ch.isMentioned)
              .reduce((sum, ch) => sum + ch.unreadCount, 0) +
            server.privateChats
              .filter((pc) => pc.isMentioned)
              .reduce((sum, pc) => sum + pc.unreadCount, 0);

          results.push({
            type: "server",
            id: `server-${server.id}`,
            title: server.name,
            description: server.host,
            serverId: server.id,
            score: 800 + totalMentions, // Between unread messages and mentions
            data: server,
          });
        }
      });

      return results.sort((a, b) => b.score - a.score).slice(0, 15);
    }

    settingsRegistry.search(query, { limit: 10 }).forEach((settingResult) => {
      results.push({
        type: "setting",
        id: `setting-${settingResult.setting.id}`,
        title: i18n._(settingResult.setting.title),
        description: settingResult.setting.description
          ? i18n._(settingResult.setting.description)
          : undefined,
        score: settingResult.score,
        data: settingResult,
      });
    });

    const actionContext = buildQuickActionContext(
      servers,
      ui,
      currentServerId,
      currentSelection,
      globalSettings,
      currentUser,
    );

    getUIActions().forEach((actionConfig) => {
      if (!actionConfig.availability(actionContext)) {
        return;
      }

      const titleMatch = fuzzyMatch(query, actionConfig.title);
      const keywordMatches = actionConfig.keywords.map((kw) =>
        fuzzyMatch(query, kw),
      );
      const bestMatch = [titleMatch, ...keywordMatches].reduce(
        (best, current) => (current.score > best.score ? current : best),
      );

      if (bestMatch.matches) {
        results.push({
          type: actionConfig.type,
          id: actionConfig.id,
          title: actionConfig.title,
          description: actionConfig.description,
          serverId: currentServerId || undefined,
          score: bestMatch.score + actionConfig.score,
          data: {
            ...actionConfig.data,
            serverId: currentServerId || undefined,
            channelId: currentSelection?.selectedChannelId || undefined,
            privateChatId: currentSelection?.selectedPrivateChatId || undefined,
            username: servers
              .find((s) => s.id === currentServerId)
              ?.privateChats.find(
                (pc) => pc.id === currentSelection?.selectedPrivateChatId,
              )?.username,
          },
        });
      }
    });

    servers.forEach((server) => {
      const isCurrentlySelectedServer = server.id === currentServerId;

      const serverMatch = fuzzyMatch(query, server.name);
      if (serverMatch.matches) {
        let scoreAdjustment = 0;
        if (isCurrentlySelectedServer) {
          scoreAdjustment = -30;
        }

        results.push({
          type: "server",
          id: `server-${server.id}`,
          title: server.name,
          description: server.host,
          serverId: server.id,
          score: serverMatch.score + scoreAdjustment,
          data: server,
        });
      }

      server.channels.forEach((channel) => {
        const channelMatch = fuzzyMatch(query, channel.name);
        if (channelMatch.matches) {
          const isCurrentlySelected =
            isCurrentlySelectedServer &&
            currentSelection?.selectedChannelId === channel.id;

          let scoreAdjustment = 0;
          if (isCurrentlySelected) {
            scoreAdjustment = -30;
          } else if (isCurrentlySelectedServer) {
            scoreAdjustment = 20;
          }

          results.push({
            type: "channel",
            id: `channel-${server.id}-${channel.id}`,
            title: voiceDisplayName(channel.name),
            description: `${server.name}${channel.topic ? ` - ${channel.topic}` : ""}`,
            serverId: server.id,
            score: channelMatch.score + scoreAdjustment,
            data: channel,
          });
        }
      });

      server.privateChats.forEach((pm) => {
        const pmMatch = fuzzyMatch(query, pm.username);
        if (pmMatch.matches) {
          const isCurrentlySelected =
            isCurrentlySelectedServer &&
            currentSelection?.selectedPrivateChatId === pm.id;

          let scoreAdjustment = 0;
          if (isCurrentlySelected) {
            scoreAdjustment = -30;
          } else if (isCurrentlySelectedServer) {
            scoreAdjustment = 20;
          }

          results.push({
            type: "dm",
            id: `dm-${server.id}-${pm.id}`,
            title: pm.username,
            description: server.name,
            serverId: server.id,
            score: pmMatch.score + scoreAdjustment,
            data: pm,
          });
        }
      });

      if (currentServerId && server.id === currentServerId) {
        results.push(
          ...getJoinChannelResults({
            query,
            serverId: server.id,
            serverName: server.name,
            joinedChannelNames: server.channels.map((ch) => ch.name),
            listEntries: channelList[server.id] || [],
            hasVoiceCapability:
              !!server.capabilities?.includes("obsidianirc/voice"),
          }),
        );
      }

      if (currentServerId && server.id === currentServerId) {
        const allUsers = new Map<
          string,
          { username: string; isOnline: boolean }
        >();
        for (const channel of server.channels) {
          for (const user of channel.users) {
            allUsers.set(user.username, {
              username: user.username,
              isOnline: user.isOnline,
            });
          }
        }

        const currentUser = ircClient.getCurrentUser(server.id);
        const availableUsers = Array.from(allUsers.values()).filter(
          (user) => user.username !== currentUser?.username,
        );

        availableUsers.forEach((user) => {
          const existingPM = server.privateChats.find(
            (pm) => pm.username === user.username,
          );
          if (!existingPM) {
            const userMatch = fuzzyMatch(query, user.username);
            if (userMatch.matches) {
              results.push({
                type: "start-dm",
                id: `start-dm-${server.id}-${user.username}`,
                title: `Message ${user.username}`,
                description: `Start private message on ${server.name}`,
                serverId: server.id,
                score: userMatch.score + (user.isOnline ? 10 : 0),
                data: undefined,
              });
            }
          }
        });
      }
    });

    return results.sort((a, b) => b.score - a.score).slice(0, 15);
  }, [
    searchQuery,
    servers,
    channelList,
    ui,
    globalSettings,
    currentUser,
    i18n._,
  ]);

  const handleUIToggle = useCallback(
    (data: UIActionData) => {
      switch (data.action as UIToggleAction) {
        case "toggle-member-list":
          toggleMemberList();
          break;
        case "toggle-channel-list":
          toggleChannelList();
          break;
        case "toggle-notifications":
          toggleNotificationSound();
          break;
        case "pin-private-chat":
          if (data.serverId && data.privateChatId) {
            pinPrivateChat(data.serverId, data.privateChatId);
          }
          break;
        case "unpin-private-chat":
          if (data.serverId && data.privateChatId) {
            unpinPrivateChat(data.serverId, data.privateChatId);
          }
          break;
      }
    },
    [toggleMemberList, toggleChannelList, pinPrivateChat, unpinPrivateChat],
  );

  const handleUIModal = useCallback(
    (data: UIActionData) => {
      switch (data.action as UIModalAction) {
        case "open-channel-settings":
          if (data.serverId && data.channelId) {
            setChannelSettingsRequest(data.serverId, data.channelId);
          }
          break;
        case "open-invite-user":
          if (data.serverId && data.channelId) {
            setInviteUserRequest(data.serverId, data.channelId);
          }
          break;
        case "open-server-channels":
          toggleChannelListModal(true);
          break;
        case "open-rename-channel":
          if (data.serverId && data.channelId) {
            setChannelSettingsRequest(data.serverId, data.channelId);
          }
          break;
        case "open-topic-modal":
          if (data.serverId && data.channelId) {
            setTopicModalRequest(data.serverId, data.channelId);
          }
          break;
        case "open-user-profile":
          if (data.serverId && data.username) {
            setProfileViewRequest(data.serverId, data.username);
            toggleUserProfileModal(true);
          }
          break;
        case "open-raw-log":
          if (data.serverId) {
            openRawLogViewer(data.serverId);
          }
          break;
      }
    },
    [
      setChannelSettingsRequest,
      setInviteUserRequest,
      toggleChannelListModal,
      setTopicModalRequest,
      setProfileViewRequest,
      toggleUserProfileModal,
      openRawLogViewer,
    ],
  );

  const handleSelect = useCallback(
    (result: QuickActionResult) => {
      switch (result.type) {
        case "setting": {
          const settingResult = result.data as SettingSearchResult;
          const setting = settingResult.setting;
          setSettingsNavigation({
            category: setting.category as
              | "profile"
              | "notifications"
              | "preferences"
              | "media"
              | "account",
            highlightedSettingId: setting.id,
          });
          toggleSettingsModal(true);
          break;
        }
        case "channel": {
          const channel = result.data as Channel;
          selectServer(result.serverId || null);
          selectChannel(channel.id, { navigate: true });
          break;
        }
        case "dm": {
          const pm = result.data as PrivateChat;
          selectServer(result.serverId || null);
          selectPrivateChat(pm.id, { navigate: true });
          break;
        }
        case "server": {
          selectServer(result.id.replace("server-", ""));
          break;
        }
        case "join-channel": {
          if (result.serverId && result.data) {
            const channelName = (result.data as { channelName: string })
              .channelName;
            selectServer(result.serverId);
            joinAndSelectChannel(result.serverId, channelName);
          }
          break;
        }
        case "start-dm": {
          if (result.serverId) {
            const username = result.title.replace("Message ", "");
            openPrivateChat(result.serverId, username);
            selectServer(result.serverId);
            const freshState = useStore.getState();
            const server = freshState.servers.find(
              (s) => s.id === result.serverId,
            );
            const privateChat = server?.privateChats?.find(
              (pc) => pc.username === username,
            );
            if (privateChat) {
              selectPrivateChat(privateChat.id, { navigate: true });
            }
          }
          break;
        }
        case "ui-toggle": {
          const actionData = result.data as UIActionData;
          handleUIToggle(actionData);
          break;
        }
        case "ui-modal": {
          const actionData = result.data as UIActionData;
          handleUIModal(actionData);
          break;
        }
      }
      handleClose();
    },
    [
      setSettingsNavigation,
      toggleSettingsModal,
      selectServer,
      selectChannel,
      selectPrivateChat,
      handleClose,
      joinAndSelectChannel,
      openPrivateChat,
      handleUIToggle,
      handleUIModal,
    ],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  const searchResultsRef = useRef<QuickActionResult[]>([]);
  const selectedIndexRef = useRef(selectedIndex);
  const handleCloseRef = useRef(handleClose);
  const handleSelectRef = useRef(handleSelect);

  searchResultsRef.current = searchResults;
  selectedIndexRef.current = selectedIndex;
  handleCloseRef.current = handleClose;
  handleSelectRef.current = handleSelect;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseRef.current();
        return;
      }

      if (searchResultsRef.current.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < searchResultsRef.current.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          } else {
            setSelectedIndex((prev) =>
              prev < searchResultsRef.current.length - 1 ? prev + 1 : prev,
            );
          }
          break;
        case "Enter":
          e.preventDefault();
          if (searchResultsRef.current[selectedIndexRef.current]) {
            handleSelectRef.current(
              searchResultsRef.current[selectedIndexRef.current],
            );
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-start justify-center z-50 pt-[15vh]"
      onClick={handleClose}
    >
      <div
        className="bg-discord-dark-200 rounded-lg w-full max-w-2xl mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-discord-dark-500 p-4">
          <FaSearch className="text-discord-text-muted mr-3" />
          <TextInput
            ref={inputRef}
            placeholder={t`Search settings, channels, servers...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-white placeholder-discord-text-muted outline-none"
            autoFocus
          />
          <button
            onClick={handleClose}
            className="text-discord-text-muted hover:text-white ml-3"
          >
            <FaTimes />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {searchResults.length === 0 ? (
            <div className="p-8 text-center text-discord-text-muted">
              {searchQuery.trim().length === 0
                ? t`No unread mentions or messages`
                : t`No results found`}
            </div>
          ) : (
            <div className="p-2">
              {searchResults.map((result, index) => {
                const getIcon = () => {
                  switch (result.type) {
                    case "setting":
                      return <FaCog className="mr-3" />;
                    case "channel":
                      return classifyChannelName(
                        (result.data as Channel).name,
                      ) === "voice" ? (
                        <FaMicrophone className="mr-3" />
                      ) : (
                        <FaHashtag className="mr-3" />
                      );
                    case "dm":
                      return <FaUser className="mr-3" />;
                    case "server":
                      return <FaServer className="mr-3" />;
                    case "join-channel":
                      return classifyChannelName(
                        (result.data as { channelName: string }).channelName,
                      ) === "voice" ? (
                        <FaMicrophone className="mr-3" />
                      ) : (
                        <FaHashtag className="mr-3" />
                      );
                    case "start-dm":
                      return <FaUser className="mr-3" />;
                    case "ui-toggle":
                    case "ui-modal": {
                      const icon = getUIActionIcon(result.id);
                      return icon ? (
                        <span className="mr-3">{icon}</span>
                      ) : (
                        <FaCog className="mr-3" />
                      );
                    }
                  }
                };

                const getTypeBadge = () => {
                  switch (result.type) {
                    case "setting":
                      return t`Setting`;
                    case "channel":
                      return t`Channel`;
                    case "dm":
                      return "DM";
                    case "server":
                      return t`Server`;
                    case "join-channel":
                      return t`Join`;
                    case "start-dm":
                      return t`New DM`;
                    case "ui-toggle":
                      return t`Toggle`;
                    case "ui-modal":
                      return getUIActionBadge(result.id);
                  }
                };

                // Get unread indicator for channels and DMs
                const getUnreadIndicator = () => {
                  if (result.type === "channel" || result.type === "dm") {
                    const item = result.data as Channel | PrivateChat;
                    if (item.isMentioned && item.unreadCount > 0) {
                      // Red badge with count for mentions
                      return (
                        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center ml-2">
                          {item.unreadCount}
                        </span>
                      );
                    }
                    if (item.unreadCount > 0) {
                      // Blue dot for unread messages
                      return (
                        <span className="w-2 h-2 bg-blue-500 rounded-full ml-2" />
                      );
                    }
                  }
                  return null;
                };

                return (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className={`w-full flex flex-col px-4 py-3 rounded text-left transition-colors ${
                      index === selectedIndex
                        ? "bg-discord-primary text-white"
                        : "text-discord-text-normal hover:bg-discord-dark-400"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        {getIcon()}
                        <span className="font-medium truncate">
                          {result.title}
                        </span>
                        {getUnreadIndicator()}
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded ml-2 whitespace-nowrap ${
                          index === selectedIndex
                            ? "bg-white/20"
                            : "bg-discord-dark-400"
                        }`}
                      >
                        {getTypeBadge()}
                      </span>
                    </div>
                    {result.description && (
                      <span
                        className={`text-sm mt-1 ml-8 truncate ${
                          index === selectedIndex
                            ? "text-white/80"
                            : "text-discord-text-muted"
                        }`}
                      >
                        {result.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickActions;
