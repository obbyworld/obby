import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheckCircle, FaChevronLeft } from "react-icons/fa";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import ircClient from "../../lib/ircClient";
import {
  getColorStyle,
  isUrlFromFilehost,
  processMarkdownInText,
} from "../../lib/ircUtils";
import { mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { User } from "../../types";
import ModerationModal, { type ModerationAction } from "../ui/ModerationModal";
import UserContextMenu from "../ui/UserContextMenu";
import UserProfileModal from "../ui/UserProfileModal";

const StatusIndicator: React.FC<{ status?: string }> = ({ status }) => {
  let bgColor = "bg-discord-dark-500"; // Default/offline

  if (status === "online") {
    bgColor = "bg-discord-green";
  } else if (status === "idle") {
    bgColor = "bg-discord-yellow";
  } else if (status === "dnd") {
    bgColor = "bg-discord-red";
  }

  return <div className={`w-3 h-3 rounded-full ${bgColor}`} />;
};

const getStatusPriority = (status?: string): number => {
  if (!status) return 1;
  let maxPriority = 1;
  for (const char of status) {
    let priority = 1;
    switch (char) {
      case "~":
        priority = 6; // owner
        break;
      case "&":
        priority = 5; // admin
        break;
      case "@":
        priority = 4; // chanop
        break;
      case "%":
        priority = 3; // halfop
        break;
      case "+":
        priority = 2; // voice
        break;
    }
    if (priority > maxPriority) maxPriority = priority;
  }
  return maxPriority;
};

const getStatusChar = (status?: string): string => {
  if (!status) return "";
  let highestPriority = 0;
  let topChar = "";
  for (const char of status) {
    let priority = 0;
    switch (char) {
      case "~":
        priority = 6;
        break;
      case "&":
        priority = 5;
        break;
      case "@":
        priority = 4;
        break;
      case "%":
        priority = 3;
        break;
      case "+":
        priority = 2;
        break;
    }
    if (priority > highestPriority) {
      highestPriority = priority;
      topChar = char;
    }
  }
  return topChar;
};

const UserItem: React.FC<{
  user: User;
  serverId: string;
  channelId: string;
  currentUser: User | null;
  onContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
  // The very first member item gets refMeasure(el) so the parent can
  // sample offsetHeight for its scrollTop-based visibility math.
  refMeasure?: (el: HTMLDivElement | null) => void;
}> = ({
  user,
  serverId,
  channelId,
  currentUser,
  onContextMenu,
  refMeasure,
}) => {
  const { t } = useLingui();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const statusTitle = (() => {
    switch (getStatusChar(user.status)) {
      case "~":
        return t`Channel Owner`;
      case "&":
        return t`Channel Admin`;
      case "@":
        return t`Channel Operator`;
      case "%":
        return t`Channel Half Operator`;
      case "+":
        return t`Voiced User`;
      default:
        return "";
    }
  })();

  const { showSafeMedia, showExternalContent } = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );

  // Get server for filehost detection
  const server = useStore((state) =>
    state.servers.find((s) => s.id === serverId),
  );

  // Display metadata like website or status
  const website = user.metadata?.url?.value || user.metadata?.website?.value;
  const metadataStatus = user.metadata?.status?.value; // Metadata status message
  const avatarUrl = user.metadata?.avatar?.value;
  const color = user.metadata?.color?.value;
  const displayName = user.metadata?.["display-name"]?.value;
  const isBot = user.isBot || user.metadata?.bot?.value === "true";
  const botInfo = user.metadata?.bot?.value; // Bot software info for tooltip

  // Check if user is an IRC operator
  const isOperator = user.modes?.includes("o") || false;
  const isIrcOp = user.isIrcOp || false;

  // Check if user is verified (account matches nickname)
  const isVerified =
    user.account &&
    user.account !== "0" &&
    user.username.toLowerCase() === user.account.toLowerCase();

  // Determine if avatar should be shown based on media controls
  const isFilehostAvatar =
    avatarUrl &&
    server?.filehost &&
    isUrlFromFilehost(avatarUrl, server.filehost);
  const shouldShowAvatar =
    avatarUrl &&
    ((isFilehostAvatar && showSafeMedia) || showExternalContent) &&
    !avatarLoadFailed;
  // Reset avatar load failed state when avatar URL changes
  useEffect(() => {
    setAvatarLoadFailed(false);
  }, []);

  return (
    <div
      ref={refMeasure}
      data-username={user.username}
      className="flex items-center gap-3 py-2 px-3 mx-2 mb-1 rounded cursor-pointer bg-discord-dark-400/30 hover:bg-discord-dark-400/50 transition-colors"
      onClick={(e) => {
        const avatarElement = e.currentTarget.querySelector(".w-10.h-10");
        onContextMenu(e, user.username, serverId, channelId, avatarElement);
      }}
    >
      {/* Avatar with status indicator */}
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-discord-dark-400 flex items-center justify-center text-white text-lg font-bold overflow-hidden">
          {shouldShowAvatar ? (
            <img
              src={avatarUrl}
              alt={user.username}
              className="w-full h-full object-cover"
              onError={() => {
                setAvatarLoadFailed(true);
              }}
            />
          ) : (
            user.username.charAt(0).toUpperCase()
          )}
        </div>
        {/* Status indicator overlay */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-dark-200 ${
            user.isAway ? "bg-yellow-500" : "bg-green-500"
          }`}
        />
      </div>

      {/* User info */}
      <div className="flex flex-col truncate min-w-0 flex-1">
        {/* Display name or username with badges */}
        <div className="flex items-center gap-1">
          {!displayName && isIrcOp && (
            <span
              className="inline-flex items-center justify-center p-2.5 w-4 h-4 text-xs text-white bg-blue-500 rounded font-bold"
              title={t`IRC Operator`}
            >
              🔑
            </span>
          )}
          {user.status && (
            <span
              className="shrink-0 bg-blue-600 text-white px-1.5 py-0.5 rounded text-xs font-bold shadow-sm"
              title={statusTitle}
            >
              {user.status}
            </span>
          )}
          <span
            className="truncate text-discord-text-normal"
            style={getColorStyle(color)}
          >
            {displayName || user.username}
            {/* Only show verified badge if NO display-name (showing username directly) */}
            {!displayName && isVerified && (
              <FaCheckCircle
                className="inline ml-1 text-green-500"
                style={{ fontSize: "0.75em", verticalAlign: "baseline" }}
                title={t`Verified account`}
              />
            )}
            {!displayName && isOperator && (
              <span
                className="inline ml-1 bg-red-600 text-white px-3 py-0.5 rounded text-xs font-bold"
                title={t`IRC Operator`}
              >
                🔑
              </span>
            )}
            {!displayName && isBot && (
              <span className="ml-1 group relative">
                🤖
                {botInfo && botInfo !== "true" && (
                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10">
                    <div className="bg-discord-dark-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                      {botInfo}
                    </div>
                  </div>
                )}
              </span>
            )}
          </span>
        </div>

        {/* Secondary info - username badge (if display-name exists), realname, status, website */}
        <div className="flex items-center gap-1.5 text-xs truncate mt-0.5">
          {displayName && (
            <>
              <span className="bg-gray-300 text-black px-1 py-0 rounded font-bold whitespace-nowrap text-[10px]">
                {user.username}
                {isVerified && (
                  <FaCheckCircle
                    className="inline ml-0.5 text-green-600"
                    style={{ fontSize: "0.75em", verticalAlign: "baseline" }}
                    title={t`Verified account`}
                  />
                )}
                {(isIrcOp || isOperator) && (
                  <span
                    className="ml-0.5 inline-flex items-center justify-center w-3 h-3 text-xs text-white bg-blue-500 rounded"
                    title={t`IRC Operator`}
                  >
                    🔑
                  </span>
                )}
                {isBot && <span className="ml-0.5">🤖</span>}
              </span>
              {(user.realname || metadataStatus || website) && (
                <span className="text-discord-text-muted opacity-50">•</span>
              )}
            </>
          )}
          {user.realname && (
            <span className="truncate text-discord-text-muted">
              {processMarkdownInText(
                user.realname,
                true,
                false,
                `member-${user.id}-realname`,
              )}
            </span>
          )}
          {user.realname && metadataStatus && (
            <span className="text-discord-text-muted opacity-50">•</span>
          )}
          {metadataStatus && (
            <span className="truncate text-discord-text-muted">
              {processMarkdownInText(
                metadataStatus,
                true,
                false,
                `member-${user.id}-status`,
              )}
            </span>
          )}
          {(user.realname || metadataStatus) && website && (
            <span className="text-discord-text-muted opacity-50">•</span>
          )}
          {website && (
            <span className="truncate text-discord-text-muted">
              🌐 {website}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const MemberList: React.FC = () => {
  const { t } = useLingui();
  const {
    servers,
    ui,
    currentUser,
    toggleMemberList,
    openPrivateChat,
    selectPrivateChat,
    warnUser,
    kickUser,
    banUserByNick,
    banUserByHostmask,
  } = useStore();

  const selectedServerId = ui.selectedServerId;
  const currentSelection = ui.perServerSelections[selectedServerId || ""] || {
    selectedChannelId: null,
    selectedPrivateChatId: null,
  };
  const { selectedChannelId } = currentSelection;

  // Lazy-metadata wiring: on scroll-stop, compute which slice of
  // sortedUsers is currently inside the scroll container's viewport
  // (from scrollTop + clientHeight, not IntersectionObserver -- IO was
  // misreporting on this layout, fetching members from the bottom of
  // the list upward instead of from the visible top). Then dispatch
  // METADATA LIST for that slice in top-to-bottom order. The store
  // dedups and the lazy queue drips so a burst of new visible nicks
  // can't hammer the server (issue #116).
  const SCROLL_IDLE_MS = 250;
  // Cap per scroll-stop so a sudden landing on a wall of unfetched
  // nicks doesn't queue hundreds at once.
  const MAX_FETCH_PER_FLUSH = 30;
  // Render a couple of off-screen rows ahead/behind so the avatars are
  // ready by the time the user scrolls to them.
  const VISIBILITY_OVERSCAN = 5;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLDivElement | null>(null);
  // Mirror of the current sorted member list so flushVisible can map an
  // index back to a nick without going through React state.
  const sortedOrderRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const flushVisible = useCallback(() => {
    if (!selectedServerId) return;
    const root = scrollContainerRef.current;
    const order = sortedOrderRef.current;
    if (!root || order.length === 0) return;
    const itemHeight = firstItemRef.current?.offsetHeight || 56;
    const start = Math.max(
      0,
      Math.floor(root.scrollTop / itemHeight) - VISIBILITY_OVERSCAN,
    );
    const end = Math.min(
      order.length,
      Math.ceil((root.scrollTop + root.clientHeight) / itemHeight) +
        VISIBILITY_OVERSCAN,
    );
    if (end <= start) return;
    const list = useStore.getState().metadataList;
    let queued = 0;
    for (let i = start; i < end && queued < MAX_FETCH_PER_FLUSH; i++) {
      const username = order[i];
      if (!username) continue;
      list(selectedServerId, username);
      queued++;
    }
  }, [selectedServerId]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushVisible, SCROLL_IDLE_MS);
  }, [flushVisible]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const onScroll = () => scheduleFlush();
    root.addEventListener("scroll", onScroll, { passive: true });
    // Initial sweep once layout has settled so the topmost visible
    // chunk gets fetched without requiring user interaction.
    scheduleFlush();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [scheduleFlush]);

  // (Initial-sweep re-arm useEffect moved below sortedUsers declaration
  //  -- see "memberlist sweep" comment further down.)

  const [userContextMenu, setUserContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    username: string;
    serverId: string;
    channelId: string;
    userStatusInChannel?: string;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    username: "",
    serverId: "",
    channelId: "",
  });
  const [moderationModal, setModerationModal] = useState<{
    isOpen: boolean;
    action: ModerationAction;
    username: string;
  }>({
    isOpen: false,
    action: "warn",
    username: "",
  });

  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [selectedProfileUsername, setSelectedProfileUsername] = useState("");

  const selectedServer = servers.find(
    (server) => server.id === selectedServerId,
  );

  const selectedChannel = selectedServer?.channels.find(
    (channel) => channel.id === selectedChannelId,
  );

  // Update currentUser.status from server.users if available, and ensure current user is in channel.users
  useEffect(() => {
    if (selectedServer && currentUser && selectedChannel) {
      // Try to sync status from server.users
      const userInServer = selectedServer.users.find(
        (u) => u.username.toLowerCase() === currentUser.username.toLowerCase(),
      );
      if (userInServer?.status && userInServer.status !== currentUser.status) {
        useStore.setState((state) =>
          state.currentUser
            ? {
                currentUser: {
                  ...state.currentUser,
                  status: userInServer.status,
                },
              }
            : {},
        );
      }
    }
  }, [selectedServer, currentUser, selectedChannel]);

  // Sort users by status priority (descending), then alphabetically by username
  const sortedUsers = selectedChannel?.users.slice().sort((a, b) => {
    const priorityA = getStatusPriority(a.status);
    const priorityB = getStatusPriority(b.status);
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }
    return a.username.localeCompare(b.username);
  });
  // Keep an order ref so flushVisible (a stable useCallback) can find
  // each visible nick's on-screen position without going back into the
  // store. Updated synchronously during render -- read in callbacks
  // that fire after.
  sortedOrderRef.current = sortedUsers?.map((u) => u.username) ?? [];

  // memberlist sweep: re-arm flushVisible whenever (a) the channel
  // changes or (b) the user count changes -- in particular when it
  // jumps from 0 to N as the batched WHO reply lands. Without this the
  // very first flushVisible runs while sortedOrderRef is still empty
  // (returns early, no fetch) and we then wait for a scroll event
  // before any metadata is requested.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scheduleFlush identity is stable
  useEffect(() => {
    scheduleFlush();
  }, [selectedChannelId, sortedUsers?.length]);

  const handleUsernameClick = (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't show context menu for own username
    // if (currentUser?.username === username) {
    //   return;
    // }

    let x = e.clientX;
    let y = e.clientY;

    // If avatar element is provided, position menu relative to it
    if (avatarElement) {
      const rect = avatarElement.getBoundingClientRect();
      x = rect.left;
      y = rect.top - 5; // Position above the avatar with small gap
    }

    // Calculate user's status in the specific channel
    console.log("MemberList handleUsernameClick - status check:", {
      serverId,
      channelId,
      currentUser: currentUser
        ? { username: currentUser.username, status: currentUser.status }
        : null,
    });

    let userStatusInChannel: string | undefined;
    if (channelId && channelId !== "server-notices") {
      const selectedServer = servers.find((s) => s.id === serverId);
      console.log("MemberList - server lookup:", {
        serverId,
        serverFound: !!selectedServer,
        serverName: selectedServer?.name,
      });

      const channel = selectedServer?.channels.find((c) => c.id === channelId);
      console.log("MemberList - channel lookup:", {
        channelId,
        channelFound: !!channel,
        channelName: channel?.name,
        usersCount: channel?.users?.length,
      });

      if (channel && currentUser) {
        const serverCurrentUser = ircClient.getCurrentUser(serverId);
        const userInChannel = channel.users.find(
          (u) =>
            u.username.toLowerCase() ===
            serverCurrentUser?.username.toLowerCase(),
        );
        console.log("MemberList - user lookup in channel:", {
          currentUsername: serverCurrentUser?.username,
          userFound: !!userInChannel,
          userStatus: userInChannel?.status,
          allUsernames: channel.users.map((u) => u.username),
        });

        userStatusInChannel = userInChannel?.status;
        console.log("MemberList - final status:", userStatusInChannel);
      } else {
        console.log("MemberList - missing data:", {
          hasChannel: !!channel,
          hasCurrentUser: !!currentUser,
        });
      }
    } else {
      console.log("MemberList - skipping status check:", {
        channelId,
        isServerNotices: channelId === "server-notices",
      });
    }

    setUserContextMenu({
      isOpen: true,
      x,
      y,
      username,
      serverId,
      channelId,
      userStatusInChannel,
    });
  };

  const handleCloseUserContextMenu = () => {
    setUserContextMenu({
      isOpen: false,
      x: 0,
      y: 0,
      username: "",
      serverId: "",
      channelId: "",
      userStatusInChannel: undefined,
    });
  };

  const handleOpenPM = (username: string) => {
    if (selectedServerId) {
      openPrivateChat(selectedServerId, username);
      // Read fresh store state so newly-created DMs are visible (stale closure fix)
      const server = useStore
        .getState()
        .servers.find((s) => s.id === selectedServerId);
      const privateChat = server?.privateChats?.find(
        (pc) => pc.username === username,
      );
      if (privateChat) {
        selectPrivateChat(privateChat.id, { navigate: true });
      }
    }
  };

  const handleOpenProfile = (username: string) => {
    setSelectedProfileUsername(username);
    setUserProfileModalOpen(true);
  };

  const isMobileView = useMediaQuery();
  return (
    <div ref={scrollContainerRef} className="px-1 py-3 h-full overflow-y-auto">
      {isMobileView && (
        <button
          onClick={() => toggleMemberList(false)}
          className="text-discord-channels-default hover:text-white mb-5"
        >
          <FaChevronLeft />
        </button>
      )}
      <h3 className="text-xs font-semibold text-discord-channels-default uppercase mb-2 px-2">
        <Trans>Members — {sortedUsers?.length || 0}</Trans>
      </h3>
      {sortedUsers?.map((user, idx) => (
        <UserItem
          key={user.id}
          user={user}
          serverId={selectedServerId || ""}
          channelId={selectedChannelId || ""}
          currentUser={currentUser}
          onContextMenu={handleUsernameClick}
          refMeasure={
            idx === 0
              ? (el) => {
                  firstItemRef.current = el;
                }
              : undefined
          }
        />
      ))}

      <UserContextMenu
        isOpen={userContextMenu.isOpen}
        x={userContextMenu.x}
        y={userContextMenu.y}
        username={userContextMenu.username}
        serverId={userContextMenu.serverId}
        channelId={userContextMenu.channelId}
        onClose={handleCloseUserContextMenu}
        onOpenPM={handleOpenPM}
        onOpenProfile={handleOpenProfile}
        currentUserStatus={userContextMenu.userStatusInChannel}
        currentUsername={
          ircClient.getCurrentUser(userContextMenu.serverId)?.username
        }
        onOpenModerationModal={(action) => {
          setModerationModal({
            isOpen: true,
            action,
            username: userContextMenu.username,
          });
        }}
      />

      <ModerationModal
        isOpen={moderationModal.isOpen}
        onClose={() =>
          setModerationModal({ isOpen: false, action: "warn", username: "" })
        }
        onConfirm={(action, reason) => {
          const { username } = moderationModal;
          switch (action) {
            case "warn":
              if (selectedServerId && selectedChannel?.name) {
                warnUser(
                  selectedServerId,
                  selectedChannel.name,
                  username,
                  reason,
                );
              }
              break;
            case "kick":
              if (selectedServerId && selectedChannel?.name) {
                kickUser(
                  selectedServerId,
                  selectedChannel.name,
                  username,
                  reason,
                );
              }
              break;
            case "ban-nick":
              if (selectedServerId && selectedChannel?.name) {
                banUserByNick(
                  selectedServerId,
                  selectedChannel.name,
                  username,
                  reason,
                );
              }
              break;
            case "ban-hostmask":
              if (selectedServerId && selectedChannel?.name) {
                banUserByHostmask(
                  selectedServerId,
                  selectedChannel.name,
                  username,
                  reason,
                );
              }
              break;
          }
          setModerationModal({ isOpen: false, action: "warn", username: "" });
        }}
        username={moderationModal.username}
        action={moderationModal.action}
      />

      {selectedServerId && (
        <UserProfileModal
          isOpen={userProfileModalOpen}
          onClose={() => setUserProfileModalOpen(false)}
          serverId={selectedServerId}
          username={selectedProfileUsername}
        />
      )}
    </div>
  );
};

export default MemberList;
