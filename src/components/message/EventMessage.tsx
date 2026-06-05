import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { Message as MessageType, User } from "../../types";

interface EventMessageProps {
  message: MessageType;
  messageUser?: User;
  showDate: boolean;
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
}

export const EventMessage: React.FC<EventMessageProps> = ({
  message,
  messageUser,
  onUsernameContextMenu,
}) => {
  const { t, i18n } = useLingui();
  const [showTooltip, setShowTooltip] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const server = useStore
    .getState()
    .servers.find((s) => s.id === message.serverId);

  const currentUser = ircClient.getCurrentUser(message.serverId);

  // Reset image load failed state when avatar URL changes
  useEffect(() => {
    setImageLoadFailed(false);
  }, []);

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat(i18n.locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    const username = message.userId;
    onUsernameContextMenu(
      e,
      username,
      message.serverId,
      message.channelId,
      e.currentTarget,
    );
  };

  const handleMouseEnter = () => {
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const username = message.userId;
  const displayName =
    messageUser?.metadata?.["display-name"]?.value || username;
  const userColor = messageUser?.metadata?.color?.value || "#888888";
  const isCurrentUser = currentUser?.username === username;
  const displayText = isCurrentUser ? t`You` : displayName;

  return (
    <div
      className="group relative flex items-center px-4 py-1 mt-2 hover:bg-discord-dark-500 transition-colors duration-75"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Small event avatar that expands on individual hover */}
      <div className="flex-shrink-0 mr-3">
        <div
          className="w-3 h-3 rounded-full bg-black flex items-center justify-center text-white text-xs cursor-pointer hover:opacity-80 transform transition-all duration-200 hover:scale-250 hover:w-8 hover:h-8 hover:text-base relative z-10 hover:z-20"
          onClick={handleAvatarClick}
        >
          {canShowAvatarUrl(
            messageUser?.metadata?.avatar?.value,
            server?.filehost,
            mediaSettings,
          ) && !imageLoadFailed ? (
            <img
              src={messageUser?.metadata?.avatar?.value}
              alt={username}
              className="w-3 h-3 rounded-full object-cover hover:w-8 hover:h-8 transition-all duration-200"
              onError={() => {
                // Use React state instead of direct DOM manipulation
                setImageLoadFailed(true);
              }}
            />
          ) : (
            username.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      {/* Event content */}
      <div className="flex-1 min-w-0">
        <span
          className="text-sm italic text-discord-text-muted font-bold cursor-pointer hover:underline"
          style={{ color: userColor }}
          onClick={handleAvatarClick}
        >
          {displayText}
        </span>{" "}
        <span className="text-sm italic text-discord-text-muted">
          {message.content}
        </span>
      </div>

      {/* Timestamp */}
      <div className="opacity-70 transition-opacity text-xs text-discord-text-muted ml-2">
        {formatTime(new Date(message.timestamp))}
      </div>

      {/* Tooltip for future collapsing functionality */}
      {showTooltip && (
        <div className="absolute bottom-full left-12 mb-1 px-2 py-1 bg-discord-dark-100 text-white text-xs rounded shadow-lg z-10 whitespace-nowrap">
          {message.type === "join" && <Trans>Joined the channel</Trans>}
          {message.type === "part" && <Trans>Left the channel</Trans>}
          {message.type === "quit" && <Trans>Quit the server</Trans>}
          {message.type === "nick" && <Trans>Changed nickname</Trans>}
          {message.type === "mode" && <Trans>Changed channel modes</Trans>}
          {message.type === "kick" && (
            <Trans>Was kicked from the channel</Trans>
          )}
        </div>
      )}
    </div>
  );
};
