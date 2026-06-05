import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { FaTimes } from "react-icons/fa";

// Inlined from react-icons/ri — avoids loading the entire RI icon sub-package (~2.1MB).
const RiReplyFill = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M11 20L1 12L11 4V9C16.5228 9 21 13.4772 21 19C21 19.2729 20.9891 19.5433 20.9676 19.8107C19.4605 16.9502 16.458 15 13 15H11V20Z" />
  </svg>
);

import { canShowImageUrl } from "../../lib/imageUtils";
import { serverFilehosts } from "../../lib/ircUtils";
import { imageCanHaveTransparency } from "../../lib/mediaUtils";
import { stripIrcFormatting } from "../../lib/messageFormatter";
import useStore from "../../store";
import type { MessageType } from "../../types";

interface MessageReplyProps {
  replyMessage: MessageType;
  theme: string;
  onUsernameClick?: (e: React.MouseEvent) => void;
  onIrcLinkClick?: (url: string) => void;
  onReplyClick?: () => void;
  onClose?: () => void;
}

const IMAGE_URL_RE = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i;

function extractFirstImageUrl(content: string): string | null {
  const stripped = stripIrcFormatting(content).trim();
  const urlRegex = /https?:\/\/[^\s,]+/gi;
  for (const raw of stripped.match(urlRegex) ?? []) {
    const url = raw.replace(/[.,!?;:)>\]]+$/, "");
    if (IMAGE_URL_RE.test(url) || url.includes("/images/")) return url;
  }
  return null;
}

export const MessageReply: React.FC<MessageReplyProps> = ({
  replyMessage,
  theme,
  onUsernameClick,
  onReplyClick,
  onClose,
}) => {
  const { t } = useLingui();
  const replyUsername = replyMessage.userId;

  const mediaVisibilityLevel = useStore(
    (state) => state.globalSettings.mediaVisibilityLevel,
  );
  const server = replyMessage.serverId
    ? useStore.getState().servers.find((s) => s.id === replyMessage.serverId)
    : null;

  const handleUsernameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUsernameClick?.(e);
  };

  const plainContent = stripIrcFormatting(replyMessage.content)
    .replace(/\n+/g, " ")
    .trim();

  const firstImageUrl = extractFirstImageUrl(replyMessage.content);

  const isClickable = !!onReplyClick && !onClose;

  return (
    <div
      className={`flex min-w-0 w-full overflow-hidden transition-colors
        ${
          onClose
            ? "bg-discord-dark-100 rounded-t-lg border-b border-white/[0.06]"
            : "bg-black/[0.22] mb-2 rounded-md border border-white/[0.04]"
        }
        ${isClickable ? "cursor-pointer hover:bg-black/[0.32]" : ""}`}
      onClick={isClickable ? onReplyClick : undefined}
      title={isClickable ? t`Click to jump to message` : ""}
    >
      <div className="w-0.5 flex-shrink-0 bg-discord-reply/70 rounded-l" />
      <div className="flex-1 min-w-0 py-1.5 px-2.5 overflow-hidden">
        <div className="flex items-center gap-1.5 mb-0.5">
          <RiReplyFill className="text-[11px] flex-shrink-0 text-discord-reply/70" />
          <span
            className="text-xs font-semibold text-discord-reply hover:underline cursor-pointer truncate"
            onClick={handleUsernameClick}
          >
            {replyUsername}
          </span>
        </div>
        <div
          className={`text-xs text-${theme}-text-muted opacity-80 ${onClose ? "line-clamp-3" : "truncate"}`}
        >
          {plainContent}
        </div>
      </div>
      {firstImageUrl &&
        canShowImageUrl(
          firstImageUrl,
          mediaVisibilityLevel,
          serverFilehosts(server),
        ) && (
          <img
            src={firstImageUrl}
            alt=""
            className={`w-10 h-10 rounded object-cover flex-shrink-0 self-center mr-1.5 my-1.5 ${imageCanHaveTransparency(firstImageUrl) ? "transparency-grid" : ""}`}
            draggable={false}
          />
        )}
      {onClose && (
        <button
          type="button"
          className="flex-shrink-0 self-center p-3 mr-1 rounded-lg hover:bg-white/10 text-discord-text-muted hover:text-discord-text-normal transition-colors"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={t`Cancel reply`}
        >
          <FaTimes className="text-base" />
        </button>
      )}
    </div>
  );
};
