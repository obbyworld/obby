import { useLingui } from "@lingui/react/macro";
import type React from "react";
import {
  FaExclamationTriangle,
  FaInfoCircle,
  FaTimesCircle,
} from "react-icons/fa";
import { processMarkdownInText } from "../../lib/ircUtils";
import { EnhancedLinkWrapper } from "../ui/LinkWrapper";

interface StandardReplyNotificationProps {
  type: "FAIL" | "WARN" | "NOTE";
  command: string;
  code: string;
  message: string;
  target?: string;
  context?: string[];
  timestamp: Date;
  onIrcLinkClick?: (url: string) => void;
}

const ICONS = {
  FAIL: <FaTimesCircle className="text-red-400" />,
  WARN: <FaExclamationTriangle className="text-yellow-400" />,
  NOTE: <FaInfoCircle className="text-discord-text-muted" />,
};

// IRCv3 standard-replies: only `<description>` is meant for people, so the
// row shows that one line in the shape of the other server events, and keeps
// the computer-readable command, code and context on its title for power users.
export const StandardReplyNotification: React.FC<
  StandardReplyNotificationProps
> = ({
  type,
  command,
  code,
  message,
  target,
  context,
  timestamp,
  onIrcLinkClick,
}) => {
  const { i18n } = useLingui();
  const ctx = context && context.length > 0 ? context : target ? [target] : [];
  const hoverTitle = `${type} ${command} ${code}${ctx.length ? ` ${ctx.join(" ")}` : ""}`;
  const description = message.trim();
  const time = new Intl.DateTimeFormat(i18n.locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

  return (
    <div
      className="flex items-start gap-3 px-4 py-1.5 text-sm"
      title={hoverTitle}
    >
      <span className="mt-0.5 flex w-4 shrink-0 justify-center text-xs">
        {ICONS[type]}
      </span>
      <span
        className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] ${
          type === "FAIL" ? "text-red-300" : "text-discord-text-normal"
        }`}
      >
        <EnhancedLinkWrapper onIrcLinkClick={onIrcLinkClick}>
          {processMarkdownInText(
            description || code,
            true,
            false,
            `standard-reply-${command}-${code}-${timestamp.getTime()}`,
          )}
        </EnhancedLinkWrapper>
      </span>
      <span className="row-meta shrink-0">{time}</span>
    </div>
  );
};
