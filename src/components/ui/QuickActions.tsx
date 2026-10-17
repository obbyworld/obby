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
import type { AppPage, SettingsSection } from "../../store/types";
import type { Channel, PrivateChat } from "../../types";
import { buildQuickActionContext } from "./QuickActions/context";
import { getJoinChannelResults } from "./QuickActions/joinChannelResults";
import {
  getPageTargets,
  settingsSectionTitle,
} from "./QuickActions/pageTargets";
import type {
  QuickActionResult,
  UIActionData,
  UIModalAction,
  UIToggleAction,
} from "./QuickActions/types";
import { getUIActionIcon, getUIActions } from "./QuickActions/uiActionConfig";
import { TextInput } from "./TextInput";

const QuickActions: React.FC = () => {
  const {
    servers,
    ui,
    channelList,
    globalSettings,
    currentUser,
    toggleQuickActions,
    openPage,
    openProfile,
    selectChannel,
    selectPrivateChat,
    selectServer,
    openPrivateChat,
    requestChatInputFocus,
    toggleMemberList,
    toggleChannelList,
    pinPrivateChat,
    unpinPrivateChat,
    setTopicModalRequest,
    setInviteUserRequest,
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
        description: `${t`Settings`} › ${settingsSectionTitle(settingResult.setting.category)}`,
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
          score: bestMatch.score + (actionConfig.score - 70) / 10,
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

    for (const target of getPageTargets(actionContext)) {
      const score = Math.max(
        fuzzyMatch(query, target.title).score,
        ...target.keywords.map((kw) => fuzzyMatch(query, kw).score * 0.9),
        fuzzyMatch(query, target.path).score * 0.5,
      );
      if (score <= 0) continue;
      results.push({
        type: "page",
        id: `page-${target.id}`,
        title: target.title,
        description: target.path,
        serverId: currentServerId || undefined,
        score,
        data: target.page,
      });
    }

    servers.forEach((server) => {
      const isCurrentlySelectedServer = server.id === currentServerId;

      const serverMatch = fuzzyMatch(query, server.name);
      if (serverMatch.matches) {
        let scoreAdjustment = 0;
        if (isCurrentlySelectedServer) {
          scoreAdjustment = -20;
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
            scoreAdjustment = -20;
          } else if (isCurrentlySelectedServer) {
            scoreAdjustment = 5;
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
            scoreAdjustment = -20;
          } else if (isCurrentlySelectedServer) {
            scoreAdjustment = 5;
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
                score: userMatch.score - 5 + (user.isOnline ? 2 : 0),
                data: undefined,
              });
            }
          }
        });
      }
    });

    return groupResults(results.sort((a, b) => b.score - a.score).slice(0, 15));
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
        case "open-invite-user":
          if (data.serverId && data.channelId) {
            setInviteUserRequest(data.serverId, data.channelId);
          }
          break;
        case "open-rename-channel": {
          const channelName = useStore
            .getState()
            .servers.find((s) => s.id === data.serverId)
            ?.channels.find((c) => c.id === data.channelId)?.name;
          if (data.serverId && channelName) {
            openPage({
              kind: "channelSettings",
              serverId: data.serverId,
              channelName,
              section: "general",
              fromSearch: true,
            });
          }
          break;
        }
        case "open-topic-modal":
          if (data.serverId && data.channelId) {
            setTopicModalRequest(data.serverId, data.channelId);
          }
          break;
        case "open-user-profile":
          if (data.serverId && data.username) {
            openProfile(data.serverId, data.username);
          }
          break;
      }
    },
    [setInviteUserRequest, setTopicModalRequest, openPage, openProfile],
  );

  const handleSelect = useCallback(
    (result: QuickActionResult) => {
      switch (result.type) {
        case "setting": {
          const settingResult = result.data as SettingSearchResult;
          const setting = settingResult.setting;
          openPage({
            kind: "settings",
            section: setting.category as SettingsSection,
            highlight: setting.id,
            fromSearch: true,
          });
          break;
        }
        case "page": {
          openPage({ ...(result.data as AppPage), fromSearch: true });
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
      openPage,
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

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const query = searchQuery.trim();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center px-2 animate-in fade-in duration-100"
      style={{
        paddingTop: "max(12vh, calc(var(--safe-area-inset-top, 0px) + 8px))",
      }}
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t`Find channels, people, settings and actions`}
        className="w-full max-w-[640px] flex flex-col overflow-hidden surface-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-14 flex items-center gap-3 px-4 bar-divider">
          <FaSearch className="w-4 h-4 text-discord-text-muted shrink-0" />
          <TextInput
            ref={inputRef}
            role="combobox"
            aria-expanded={searchResults.length > 0}
            aria-controls="quick-actions-results"
            aria-activedescendant={
              searchResults.length > 0
                ? `quick-action-${selectedIndex}`
                : undefined
            }
            aria-label={t`Find channels, people, settings and actions`}
            placeholder={t`Find channels, people, settings and actions`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-[15px] text-white placeholder:text-discord-text-muted outline-none"
            autoFocus
          />
          <button
            type="button"
            onClick={handleClose}
            aria-label={t`Close`}
            className="icon-button w-10 h-10 rounded-lg"
          >
            <FaTimes />
          </button>
        </div>

        <div
          ref={listRef}
          id="quick-actions-results"
          role="listbox"
          className="overflow-y-auto overscroll-contain p-2"
          style={{
            maxHeight:
              "min(60vh, 480px, calc(100dvh - var(--keyboard-height, 0px) - 12vh - 7rem))",
          }}
        >
          {searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-discord-text-muted">
              {query.length === 0
                ? t`No unread mentions or messages. Type to search`
                : t`No results. Try fewer letters`}
            </div>
          ) : (
            searchResults.map((result, index) => {
              const isSelected = index === selectedIndex;
              const group = resultGroupTitle(result);
              const showGroup =
                index === 0 ||
                resultGroupTitle(searchResults[index - 1]) !== group;
              return (
                <div key={result.id}>
                  {showGroup && (
                    <div className="section-label pt-2.5">{group}</div>
                  )}
                  <button
                    type="button"
                    id={`quick-action-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    data-result-index={index}
                    onClick={() => handleSelect(result)}
                    onMouseMove={() => !isSelected && setSelectedIndex(index)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left ${
                      isSelected ? "bg-white/[0.08]" : ""
                    }`}
                  >
                    <span
                      className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[13px] ${
                        isSelected
                          ? "bg-discord-primary text-white"
                          : "bg-discord-dark-300 text-discord-text-normal"
                      }`}
                    >
                      {resultIcon(result)}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="truncate text-sm text-white">
                        <MatchedText text={result.title} query={query} />
                      </span>
                      {result.description && (
                        <span className="truncate text-xs text-discord-text-muted">
                          {result.description}
                        </span>
                      )}
                    </span>
                    <UnreadIndicator result={result} />
                    {isSelected && (
                      <span className="hidden sm:inline shrink-0 text-xs text-discord-text-muted">
                        ↵
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="hidden sm:flex gap-4 px-4 h-9 items-center text-xs text-discord-text-muted shadow-[0_-1px_0_rgba(0,0,0,0.25)]">
          <span>{t`↑ ↓ to move`}</span>
          <span>{t`↵ to open`}</span>
          <span>{t`esc to close`}</span>
        </div>
      </div>
    </div>
  );
};

function resultGroupTitle(result: QuickActionResult): string {
  switch (result.type) {
    case "setting":
      return t`Settings`;
    case "page":
      return t`Pages`;
    case "channel":
    case "join-channel":
      return t`Channels`;
    case "dm":
    case "start-dm":
      return t`People`;
    case "server":
      return t`Servers`;
    case "ui-toggle":
    case "ui-modal":
      return t`Actions`;
  }
}

// We keep each kind of result together, ordered by its best match.
function groupResults(sorted: QuickActionResult[]): QuickActionResult[] {
  const groups = new Map<string, QuickActionResult[]>();
  for (const result of sorted) {
    const key = resultGroupTitle(result);
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].flat();
}

function resultIcon(result: QuickActionResult): React.ReactNode {
  switch (result.type) {
    case "setting":
    case "page":
      return <FaCog />;
    case "channel":
    case "join-channel": {
      const name =
        result.type === "channel"
          ? (result.data as Channel).name
          : (result.data as { channelName: string }).channelName;
      return classifyChannelName(name) === "voice" ? (
        <FaMicrophone />
      ) : (
        <FaHashtag />
      );
    }
    case "dm":
    case "start-dm":
      return <FaUser />;
    case "server":
      return <FaServer />;
    case "ui-toggle":
    case "ui-modal":
      return getUIActionIcon(result.id) ?? <FaCog />;
  }
}

const MatchedText: React.FC<{ text: string; query: string }> = ({
  text,
  query,
}) => {
  const { ranges } = fuzzyMatch(query, text);
  if (!query || ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={start}
        className="bg-transparent text-white font-semibold underline decoration-discord-primary decoration-2 underline-offset-[3px]"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
};

const UnreadIndicator: React.FC<{ result: QuickActionResult }> = ({
  result,
}) => {
  if (result.type !== "channel" && result.type !== "dm") return null;
  const item = result.data as Channel | PrivateChat;
  if (item.isMentioned && item.unreadCount > 0) {
    return (
      <span className="shrink-0 bg-discord-red text-white text-xs font-bold rounded-full px-1.5 min-w-[20px] text-center">
        {item.unreadCount}
      </span>
    );
  }
  if (item.unreadCount > 0) {
    return <span className="shrink-0 w-2 h-2 rounded-full bg-white" />;
  }
  return null;
};

export default QuickActions;
