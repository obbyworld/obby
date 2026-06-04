import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { type EventGroup, getEventGroupTooltip } from "../../lib/eventGrouping";
import ircClient from "../../lib/ircClient";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { User } from "../../types";

interface CollapsedEventMessageProps {
  eventGroup: EventGroup;
  users: User[];
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
}

export const CollapsedEventMessage: React.FC<CollapsedEventMessageProps> = ({
  eventGroup,
  users,
  onUsernameContextMenu,
}) => {
  const { t, i18n } = useLingui();
  const [showTooltip, setShowTooltip] = useState(false);
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());
  const serverId = eventGroup.messages[0]?.serverId || "";
  const channelId = eventGroup.messages[0]?.channelId || "";
  const ircCurrentUser = ircClient.getCurrentUser(serverId);
  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const server = useStore.getState().servers.find((s) => s.id === serverId);

  if (eventGroup.type !== "eventGroup") return null;

  const formatTime = (date: Date) =>
    new Intl.DateTimeFormat(i18n.locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const tooltip = getEventGroupTooltip(eventGroup);

  const renderAvatar = (username: string, size: "sm" | "xs" = "sm") => {
    const user = users.find((u) => u.username === username);
    const dim = size === "sm" ? "w-4 h-4 text-[10px]" : "w-3 h-3 text-[8px]";
    return (
      <div
        key={username}
        className={`${dim} bg-discord-dark-400 border border-discord-dark-200 rounded-full flex-shrink-0 flex items-center justify-center text-white cursor-pointer hover:opacity-80 overflow-hidden`}
        onClick={(e) =>
          onUsernameContextMenu(
            e,
            username,
            serverId,
            channelId,
            e.currentTarget,
          )
        }
      >
        {canShowAvatarUrl(
          user?.metadata?.avatar?.value,
          server?.filehost,
          mediaSettings,
        ) && !failedAvatars.has(username) ? (
          <img
            src={user?.metadata?.avatar?.value}
            alt={username}
            className="w-full h-full rounded-full object-cover"
            onError={() =>
              setFailedAvatars((prev) => new Set(prev).add(username))
            }
          />
        ) : (
          username.charAt(0).toUpperCase()
        )}
      </div>
    );
  };

  // New per-user summary rendering
  if (eventGroup.userSummaries && eventGroup.userSummaries.length > 0) {
    return (
      <div
        className="relative px-4 py-1 mt-1 hover:bg-discord-dark-500 transition-colors duration-75"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {eventGroup.userSummaries.map((us) => {
          const displayName =
            us.username === ircCurrentUser?.username ? t`You` : us.username;
          return (
            <div key={us.username} className="flex items-center gap-2 py-0.5">
              {renderAvatar(us.username, "sm")}
              <span className="text-sm italic text-discord-text-muted flex-1 min-w-0">
                <button
                  type="button"
                  className="font-medium not-italic hover:underline cursor-pointer bg-transparent border-none p-0 text-discord-text-muted"
                  onClick={(e) =>
                    onUsernameContextMenu(e, us.username, serverId, channelId)
                  }
                >
                  {displayName}
                </button>{" "}
                {us.summary}
              </span>
              <span className="text-xs text-discord-text-muted flex-shrink-0">
                {formatTime(us.timestamp)}
              </span>
            </div>
          );
        })}

        {showTooltip && tooltip && (
          <div className="absolute bottom-full left-4 mb-1 px-2 py-1 bg-discord-dark-100 text-white text-xs rounded shadow-lg z-20 whitespace-pre-line">
            {tooltip}
          </div>
        )}
      </div>
    );
  }

  // Legacy fallback (single-type group from old format)
  const uniqueUsernames: string[] = Array.from(
    new Set(eventGroup.usernames ?? []),
  );
  const summary = eventGroup.usernames
    ? uniqueUsernames.map((u) => u).join(", ")
    : "";

  return (
    <div
      className="group relative flex items-center px-4 py-1 mt-2 hover:bg-discord-dark-500 transition-colors duration-75"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex-shrink-0 mr-3 flex items-center">
        <div className="flex -space-x-1">
          {uniqueUsernames
            .slice(0, 3)
            .map((username) => renderAvatar(username, "xs"))}
          {uniqueUsernames.length > 3 && (
            <div className="w-3 h-3 bg-discord-dark-400 border border-discord-dark-200 rounded-full flex items-center justify-center text-xs text-discord-text-muted font-medium">
              +{uniqueUsernames.length - 3}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm italic text-discord-text-muted">
          {summary}
        </span>
      </div>
      <div className="opacity-70 text-xs text-discord-text-muted ml-2">
        {formatTime(eventGroup.timestamp)}
      </div>
      {showTooltip && tooltip && (
        <div className="absolute bottom-full left-12 mb-1 px-2 py-1 bg-discord-dark-100 text-white text-xs rounded shadow-lg z-20 whitespace-pre-line">
          {tooltip}
        </div>
      )}
    </div>
  );
};
