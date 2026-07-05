import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { getColorStyle } from "../../lib/ircUtils";
import { E2EEUnprotectedBadge } from "./E2EEUnprotectedBadge";

interface MessageHeaderProps {
  userId: string;
  displayName?: string;
  userColor?: string;
  timestamp: Date;
  theme: string;
  isClickable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  isBot?: boolean;
  isVerified?: boolean;
  isIrcOp?: boolean;
  unprotected?: boolean;
}

export const MessageHeader: React.FC<MessageHeaderProps> = ({
  userId,
  displayName,
  userColor,
  timestamp,
  theme,
  isClickable = false,
  onClick,
  isBot = false,
  isVerified = false,
  isIrcOp = false,
  unprotected = false,
}) => {
  const { t } = useLingui();
  const username = userId;
  const isSystem = userId === "system";

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <div className="flex items-center select-none">
      <span
        className={`font-bold text-white ${isClickable ? "cursor-pointer" : ""}`}
        style={getColorStyle(userColor)}
        onClick={onClick}
      >
        {isSystem ? "System" : displayName || username}
        {isBot && <span className="ml-1 text-xs">🤖</span>}
        {isVerified && (
          <span
            className="ml-1 inline-flex items-center justify-center w-4 h-4 text-xs text-white bg-green-500 rounded-full"
            title={t`User is authenticated`}
          >
            ✓
          </span>
        )}
        {isIrcOp && (
          <span
            className="ml-1 inline-flex items-center justify-center w-4 h-4 text-xs text-white bg-blue-500 rounded"
            title={t`IRC Operator`}
          >
            🔑
          </span>
        )}
        {displayName && (
          <span className="ml-2 text-xs bg-discord-dark-600 px-1 py-0.5 rounded">
            {username}
          </span>
        )}
      </span>
      <span className={`ml-2 text-xs text-${theme}-text-muted`}>
        {formatTime(timestamp)}
      </span>
      {unprotected && <E2EEUnprotectedBadge />}
    </div>
  );
};
