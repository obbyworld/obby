import { t } from "@lingui/core/macro";
import type * as React from "react";
import { FaCheckCircle, FaThumbtack, FaTrash, FaUser } from "react-icons/fa";
import { useLongPress } from "../../hooks/useLongPress";
import { processMarkdownInText, serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, type MediaSettings } from "../../lib/mediaUtils";
import { loadSavedMetadata } from "../../store";
import type { PrivateChat, Server, User } from "../../types";
import type { DragRowProps } from "./ChannelRow";

function getUserMetadata(server: Server | undefined, username: string) {
  if (!server) return null;

  const savedMetadata = loadSavedMetadata();
  const serverMetadata = savedMetadata[server.id];
  if (serverMetadata?.[username]) {
    return serverMetadata[username];
  }

  for (const channel of server.channels) {
    const user = channel.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (user?.metadata && Object.keys(user.metadata).length > 0) {
      return user.metadata;
    }
  }

  return null;
}

function getUserFromChannels(server: Server | undefined, username: string) {
  if (!server) return null;

  for (const channel of server.channels) {
    const user = channel.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (user) return user;
  }

  return null;
}

function renderUserBadges(
  username: string,
  privateChat: PrivateChat | undefined,
  user: User | null,
  showVerified = true,
) {
  const account = privateChat?.account || user?.account;
  const isBot =
    privateChat?.isBot || user?.isBot || user?.metadata?.bot?.value === "true";
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
}

interface PrivateChatRowProps {
  privateChat: PrivateChat;
  server: Server | undefined;
  mediaSettings: MediaSettings;
  isSelected: boolean;
  isPrevious: boolean;
  isTouch: boolean;
  hoverClass: string;
  drag?: DragRowProps;
  onSelect: () => void;
  onLongPressSelect: () => void;
  onPinToggle: () => void;
  onDelete: () => void;
}

export const PrivateChatRow: React.FC<PrivateChatRowProps> = ({
  privateChat,
  server,
  mediaSettings,
  isSelected,
  isPrevious,
  isTouch,
  hoverClass,
  drag,
  onSelect,
  onLongPressSelect,
  onPinToggle,
  onDelete,
}) => {
  const longPress = useLongPress({
    delay: 300,
    onLongPress: onLongPressSelect,
  });

  const userMetadata = getUserMetadata(server, privateChat.username);
  const avatarUrl = userMetadata?.avatar?.value;
  const shouldShowAvatar = canShowAvatarUrl(
    avatarUrl,
    serverFilehosts(server),
    mediaSettings,
  );
  const displayName = userMetadata?.["display-name"]?.value;
  const user = getUserFromChannels(server, privateChat.username);
  const showUsernameBadge = !!displayName;

  let secondPart: React.ReactNode = null;
  if (!displayName) {
    const realname = privateChat.realname || user?.realname;
    if (realname) {
      secondPart = processMarkdownInText(
        realname,
        true,
        false,
        `privatechat-${privateChat.id}-realname`,
      );
    }
  }

  const awayMsg = privateChat.awayMessage;
  const statusText = userMetadata?.status?.value;
  const statusOrAway = awayMsg || statusText;
  const isAway = !!awayMsg;

  if (secondPart && statusOrAway) {
    secondPart = (
      <>
        {secondPart}
        <span className="text-discord-text-muted opacity-50 mx-1.5">•</span>
        <span
          className={`text-discord-text-muted truncate ${isAway ? "italic" : ""}`}
        >
          {statusOrAway}
        </span>
      </>
    );
  } else if (!secondPart && statusOrAway) {
    secondPart = (
      <span
        className={`text-discord-text-muted truncate ${isAway ? "italic" : ""}`}
      >
        {statusOrAway}
      </span>
    );
  }

  return (
    <div
      {...drag}
      className={`
        group
        px-2 py-1 mb-1 rounded-md flex items-center justify-between max-w-full
        transition-all duration-200 ease-in-out
        shadow-sm
        ${
          isSelected
            ? "bg-black text-white"
            : `bg-discord-dark-400/50 ${hoverClass}`
        }
        ${
          isPrevious && !isSelected
            ? "border-l-2 border-amber-400/70"
            : "border-l-2 border-transparent"
        }
        ${drag?.className ?? ""}
      `}
      style={
        {
          backgroundColor: !isSelected
            ? privateChat.isOnline
              ? privateChat.isAway
                ? "rgba(234, 179, 8, 0.12)" // yellow tint for away
                : undefined // default like channels
              : "rgba(107, 114, 128, 0.08)" // gray tint for offline
            : undefined,
          "--bg-color": isSelected ? "#000" : "rgba(47, 49, 54, 0.5)",
          ...drag?.style,
        } as React.CSSProperties
      }
      onTouchStart={isTouch ? longPress.onTouchStart : undefined}
      onTouchEnd={isTouch ? longPress.onTouchEnd : undefined}
      onTouchMove={isTouch ? longPress.onTouchMove : undefined}
      onClick={() => {
        if (longPress.firedRef.current) {
          longPress.firedRef.current = false;
          return;
        }
        onSelect();
      }}
    >
      <div className="flex items-center gap-2 truncate">
        {/* User avatar with status indicator */}
        <div className="relative flex-shrink-0">
          {shouldShowAvatar ? (
            <img
              src={avatarUrl}
              alt={privateChat.username}
              className={`rounded-full object-cover ${
                isSelected ? "w-8 h-8" : "w-6 h-6"
              }`}
              onError={(e) => {
                // Fallback to FaUser icon on error
                e.currentTarget.style.display = "none";
                const parent = e.currentTarget.parentElement;
                const fallbackIcon = parent?.querySelector(
                  ".fallback-user-icon",
                );
                if (fallbackIcon) {
                  (fallbackIcon as HTMLElement).style.display = "block";
                }
              }}
            />
          ) : (
            <FaUser
              className={`shrink-0 fallback-user-icon ${
                isSelected ? "text-2xl" : ""
              }`}
            />
          )}
          {/* Fallback icon (hidden by default if avatar exists) */}
          {shouldShowAvatar ? (
            <FaUser
              className={`shrink-0 fallback-user-icon ${
                isSelected ? "text-2xl" : ""
              }`}
              style={{ display: "none" }}
            />
          ) : null}
          {/* Status indicator */}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-dark-200 ${
              privateChat.isOnline
                ? privateChat.isAway
                  ? "bg-yellow-500"
                  : "bg-green-500"
                : "bg-gray-500"
            }`}
            title={
              privateChat.isOnline
                ? privateChat.isAway
                  ? t`Away`
                  : t`Online`
                : t`Offline`
            }
          />
        </div>
        <div className="flex flex-col truncate min-w-0">
          {/* Display name or username */}
          <span className="truncate font-medium max-w-full">
            {displayName || privateChat.username}
            {/* Only show verified badge if NO display-name (showing username directly) */}
            {renderUserBadges(
              privateChat.username,
              privateChat,
              user,
              !displayName,
            )}
          </span>
          {/* Badge with nick/realname and status/away message */}
          <div className="flex items-center gap-1.5 text-xs truncate">
            {showUsernameBadge && secondPart ? (
              <>
                <span
                  className={`bg-gray-300 text-black px-0.5 py-0 rounded font-bold whitespace-nowrap ${
                    isSelected ? "text-[11px]" : "text-[9px]"
                  }`}
                >
                  {privateChat.username}
                  {renderUserBadges(privateChat.username, privateChat, user)}
                </span>
                <span className="text-discord-text-muted opacity-50">•</span>
                {secondPart}
              </>
            ) : showUsernameBadge ? (
              <span
                className={`bg-gray-300 text-black px-0.5 py-0 rounded font-bold whitespace-nowrap ${
                  isSelected ? "text-[11px]" : "text-[9px]"
                }`}
              >
                {privateChat.username}
                {renderUserBadges(privateChat.username, privateChat, user)}
              </span>
            ) : (
              secondPart
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Unread/Mention indicators */}
        {!isSelected &&
          (privateChat.isMentioned && (privateChat.mentionCount ?? 0) > 0 ? (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {privateChat.mentionCount}
            </span>
          ) : privateChat.unreadCount > 0 ? (
            <span className="w-2 h-2 bg-blue-500 rounded-full" />
          ) : null)}
        {/* Pin/Unpin and Delete Buttons */}
        {isSelected && (
          <>
            <button
              className={`${
                isTouch
                  ? "block" // Always visible on mobile
                  : "hidden group-hover:block" // Show on hover on desktop
              } ${
                privateChat.isPinned
                  ? "text-green-500 hover:text-green-400"
                  : "text-discord-text-muted hover:text-yellow-400"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onPinToggle();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title={privateChat.isPinned ? t`Unpin` : t`Pin`}
            >
              <FaThumbtack
                className={privateChat.isPinned ? "" : "rotate-[25deg]"}
                style={
                  privateChat.isPinned ? {} : { transform: "rotate(25deg)" }
                }
              />
            </button>
            {!privateChat.isPinned && (
              <button
                className={`text-discord-red hover:text-white ${
                  isTouch
                    ? "block" // Always visible on mobile
                    : "hidden group-hover:block" // Show on hover on desktop
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onDelete();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                title={t`Close`}
              >
                <FaTrash />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PrivateChatRow;
