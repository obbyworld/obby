import { t } from "@lingui/core/macro";
import type React from "react";
import ircClient from "../../lib/ircClient";
import type { MessageType, User } from "../../types";
import { BotInvocationChip } from "./BotInvocationChip";
import { MessageAvatar } from "./MessageAvatar";
import { MessageReply } from "./MessageReply";
import { ReactionsWithActions } from "./ReactionsWithActions";

interface ActionMessageProps {
  message: MessageType;
  showDate: boolean;
  messageUser?: User;
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
  setReplyTo: (msg: MessageType) => void;
  onReactClick: (message: MessageType, buttonElement: Element) => void;
  onReactionUnreact: (emoji: string, message: MessageType) => void;
  onDirectReaction: (emoji: string, message: MessageType) => void;
}

export const ActionMessage: React.FC<ActionMessageProps> = ({
  message,
  showDate,
  messageUser,
  onUsernameContextMenu,
  setReplyTo,
  onReactClick,
  onReactionUnreact,
  onDirectReaction,
}) => {
  const currentUser = ircClient.getCurrentUser(message.serverId);
  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const displayName = messageUser?.metadata?.["display-name"]?.value;
  const username = message.userId;
  const isBot =
    messageUser?.isBot ||
    messageUser?.metadata?.bot?.value === "true" ||
    message.tags?.bot === "";

  return (
    <div className="px-4 py-1 hover:bg-discord-message-hover group relative">
      {showDate && (
        <div className="flex items-center text-xs text-discord-text-muted mb-2">
          <div className="flex-grow border-t border-discord-dark-400" />
          <div className="px-2">{formatDate(new Date(message.timestamp))}</div>
          <div className="flex-grow border-t border-discord-dark-400" />
        </div>
      )}
      <div className="flex">
        <MessageAvatar
          userId={message.userId}
          avatarUrl={messageUser?.metadata?.avatar?.value}
          userStatus={messageUser?.metadata?.status?.value}
          isAway={messageUser?.isAway}
          theme="discord"
          showHeader={true}
          onClick={(e) => {
            onUsernameContextMenu(
              e,
              username,
              message.serverId,
              message.channelId,
              e.currentTarget,
            );
          }}
          isClickable={true}
          serverId={message.serverId}
        />
        <div className="flex-1 text-white">
          <div className="flex items-center">
            <span className="ml-2 text-xs text-discord-text-muted">
              {formatTime(new Date(message.timestamp))}
            </span>
          </div>
          {isBot && (
            <BotInvocationChip tagValue={message.tags?.["+draft/invoked-by"]} />
          )}
          {message.replyMessage && (
            <MessageReply replyMessage={message.replyMessage} theme="discord" />
          )}
          <span className="italic text-white">
            {message.userId === "system"
              ? t`System`
              : (displayName || username) +
                (displayName ? ` (${username})` : "") +
                message.content.substring(7, message.content.length - 1)}
          </span>
          <ReactionsWithActions
            message={message}
            currentUserUsername={currentUser?.username ?? currentUser?.id}
            onReactionClick={(emoji, currentUserReacted) => {
              if (currentUserReacted) {
                onReactionUnreact(emoji, message);
              } else {
                onDirectReaction(emoji, message);
              }
            }}
            onReactClick={(el) => onReactClick(message, el)}
            onReplyClick={() => setReplyTo(message)}
            canReply={!!message.msgid}
          />
        </div>
      </div>
    </div>
  );
};
