import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect } from "react";
import {
  FaChevronRight,
  FaExclamationTriangle,
  FaInfoCircle,
  FaTimes,
  FaTimesCircle,
} from "react-icons/fa";
import {
  JUMP_FAILURE_COMMAND,
  type JumpFailure,
} from "../../lib/jumpToMessage";
import useStore from "../../store";
import { SERVER_NOTICES_ID } from "../../store/handlers/serverReplies";

const TOAST_MS = 5000;

function jumpFailureText(code: string): string {
  switch (code as JumpFailure) {
    case "left-channel":
      return t`Join this channel to jump to the message`;
    case "not-saved":
      return t`This message is no longer saved`;
    default:
      return t`Could not find this message`;
  }
}

const ICONS = {
  fail: <FaTimesCircle className="text-red-400" />,
  warn: <FaExclamationTriangle className="text-yellow-400" />,
  note: <FaInfoCircle className="text-discord-text-muted" />,
};

/** One toast at a time for the problem the user most likely just caused; the
 *  server's notices keep every reply, so the toast can vanish quickly. */
export const GlobalNotifications: React.FC = () => {
  const { t } = useLingui();
  const notifications = useStore((s) => s.globalNotifications);
  const clearGlobalNotifications = useStore((s) => s.clearGlobalNotifications);
  const latest = notifications[notifications.length - 1];
  const hasServer = useStore((s) =>
    s.servers.some((server) => server.id === latest?.serverId),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(clearGlobalNotifications, TOAST_MS);
    return () => clearTimeout(timer);
  }, [latest?.id]);

  if (!latest) return null;
  const isJumpFailure = latest.command === JUMP_FAILURE_COMMAND;
  const opensNotices = hasServer && !!latest.inServerNotices;

  const openNotices = () => {
    const { selectServer, selectChannel } = useStore.getState();
    selectServer(latest.serverId);
    selectChannel(SERVER_NOTICES_ID, { navigate: true });
    clearGlobalNotifications();
  };
  const otherCount = notifications.length - 1;

  return (
    <div
      role="status"
      className="fixed z-[10001] flex justify-center left-[calc(0.75rem+var(--safe-area-inset-left,0px))] right-[calc(0.75rem+var(--safe-area-inset-right,0px))] top-[calc(3.75rem+var(--safe-area-inset-top,0px))] md:top-auto md:left-auto md:right-6 md:bottom-6 md:w-[22rem]"
    >
      <div className="surface-floating flex w-full max-w-md items-center gap-3 rounded-xl py-2.5 pl-3 pr-1.5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
        <span className="shrink-0 text-sm">{ICONS[latest.type]}</span>
        <button
          type="button"
          onClick={opensNotices ? openNotices : clearGlobalNotifications}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-discord-text-normal"
          title={opensNotices ? t`See server notices` : undefined}
        >
          <span className="line-clamp-2 min-w-0 flex-1">
            {isJumpFailure ? jumpFailureText(latest.code) : latest.message}
            {otherCount > 0 && (
              <span className="row-meta ml-1.5">+{otherCount}</span>
            )}
          </span>
          {opensNotices && (
            <FaChevronRight className="shrink-0 text-xs text-discord-text-muted" />
          )}
        </button>
        <button
          type="button"
          onClick={clearGlobalNotifications}
          aria-label={t`Dismiss notification`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-discord-text-muted hover:text-white"
        >
          <FaTimes className="text-xs" />
        </button>
      </div>
    </div>
  );
};
