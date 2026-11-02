import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useMemo } from "react";
import { FaTimes, FaUserCheck } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import ircClient from "../../lib/ircClient";
import useStore, { loadSavedServers } from "../../store";
import { getLoginState } from "../../store/helpers";
import type { Server } from "../../types";

export type NickPromptMode = "login" | "register" | "verify" | "loggedOut";

// Services refuse to register guest nicks, and our own default nick is a placeholder nobody chose.
const isPlaceholderNick = (nick: string): boolean =>
  /^guest\d+$/i.test(nick) || /^user\d+$/i.test(nick);

export function getNickPromptMode(
  server: Server,
  nick: string | undefined,
): NickPromptMode | null {
  if (!nick || server.bouncerServerId) return null;
  if (server.nickClaim?.stage === "verify") return "verify";
  if (getLoginState(server) !== "guest") return null;
  if (server.registeredNick?.toLowerCase() === nick.toLowerCase())
    return "login";
  if (
    server.capabilities?.includes("draft/account-registration") &&
    !isPlaceholderNick(nick)
  )
    return "register";
  return "loggedOut";
}

export const NickClaimStrip: React.FC<{ server: Server }> = ({ server }) => {
  // The store updates on every NICK, so this selector sees our new nick.
  const nick = useStore(() => ircClient.getNick(server.id));
  const isTouch = useIsTouchInput();
  const isDismissed = useMemo(
    () =>
      !!server.isNickPromptHidden ||
      !!loadSavedServers().find((s) => s.id === server.id)?.skipNickPrompt,
    [server.id, server.isNickPromptHidden],
  );

  const mode = isDismissed ? null : getNickPromptMode(server, nick);
  if (!mode || !nick) return null;

  const title = {
    verify: <Trans>Enter the code sent to your email</Trans>,
    login: (
      <Trans>
        <strong className="text-white">{nick}</strong> is registered. Log in to
        use it
      </Trans>
    ),
    register: (
      <Trans>
        <strong className="text-white">{nick}</strong> is not registered.
        Register it to keep it
      </Trans>
    ),
    loggedOut: <Trans>You are not logged in</Trans>,
  }[mode];
  const actionLabel = {
    verify: t`Enter code`,
    login: t`Log in`,
    register: t`Register`,
    loggedOut: t`Log in`,
  }[mode];

  return (
    <section
      aria-label={t`Your account`}
      className="strip-card border-discord-primary/35 bg-discord-primary/10"
    >
      <div className="strip-header">
        <FaUserCheck className="mt-0.5 shrink-0 text-discord-primary" />
        <span className="flex-1 min-w-0 break-words">{title}</span>
        <button
          type="button"
          onClick={() => useStore.getState().hideNickPrompt(server.id)}
          title={t`Don't show again for this server`}
          aria-label={t`Don't show again for this server`}
          className={`shrink-0 flex items-center justify-center rounded text-discord-text-muted hover:text-white ${isTouch ? "w-11 h-11 -m-2.5" : "w-5 h-5"}`}
        >
          <FaTimes />
        </button>
      </div>
      <button
        type="button"
        onClick={() =>
          useStore.getState().openPage({
            kind: "serverSettings",
            serverId: server.id,
            section: "auth",
          })
        }
        className="strip-action button-primary self-start"
      >
        {actionLabel}
      </button>
    </section>
  );
};

export default NickClaimStrip;
