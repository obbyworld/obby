import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useState } from "react";
import { FaTimes, FaUserCheck } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import { getLoginState } from "../../store/helpers";
import type { NickClaim, Server } from "../../types";
import { TextInput } from "../ui/TextInput";

export type NickPromptMode = "login" | "register" | "verify";

export function getNickPromptMode(
  server: Server,
  nick: string | undefined,
): NickPromptMode | null {
  if (!nick || server.isNickPromptHidden || server.bouncerServerId) return null;
  if (getLoginState(server) !== "guest") return null;
  if (!server.capabilities?.includes("draft/account-registration")) return null;
  if (server.nickClaim?.stage === "verify") return "verify";
  return server.registeredNick?.toLowerCase() === nick.toLowerCase()
    ? "login"
    : "register";
}

function failureText(failure: NonNullable<NickClaim["failure"]>): string {
  switch (failure.code) {
    case "BAD_ACCOUNT_NAME":
    case "NEED_NICK":
      return t`Change your nick to register, this one is not allowed`;
    case "BAD_PASSWORD":
    case "WEAK_PASSWORD":
    case "UNACCEPTABLE_PASSWORD":
      return t`Choose a longer password`;
    case "BAD_EMAIL":
    case "UNACCEPTABLE_EMAIL":
      return t`Enter a valid email address`;
    case "BAD_CODE":
      return t`Check the code and try again`;
    case "CODE_EXPIRED":
      return t`The code expired. Ask the server operators for help`;
    default:
      return failure.command === "VERIFY"
        ? t`Could not verify. Try again`
        : t`Could not register. Try again`;
  }
}

function isEmailRequired(server: Server): boolean {
  return (
    server.capabilityValues?.["draft/account-registration"]
      ?.split(",")
      .includes("email-required") ?? false
  );
}

export const NickClaimStrip: React.FC<{ server: Server }> = ({ server }) => {
  // The store updates on every NICK, so this selector sees our new nick.
  const nick = useStore(() => ircClient.getNick(server.id));
  const isTouch = useIsTouchInput();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isUnencodable, setIsUnencodable] = useState(false);

  const mode = getNickPromptMode(server, nick);
  if (!mode || !nick) return null;

  const claim = server.nickClaim;
  const isSending = claim?.stage === "sending";
  const needsEmail = mode === "register" && isEmailRequired(server);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { claimNick, verifyNickClaim, logInToNick } = useStore.getState();
    if (mode === "verify") {
      verifyNickClaim(server.id, code.trim());
      return;
    }
    const isStored =
      mode === "login"
        ? logInToNick(server.id, nick, password)
        : claimNick(server.id, nick, email.trim() || "*", password);
    setIsUnencodable(!isStored);
  };

  const title =
    mode === "verify" ? (
      <Trans>Enter the code sent to your email</Trans>
    ) : mode === "login" ? (
      <Trans>
        <strong className="text-white">{nick}</strong> is registered. Log in to
        use it
      </Trans>
    ) : (
      <Trans>
        Make <strong className="text-white">{nick}</strong> yours. Set a
        password to register it
      </Trans>
    );
  const submitLabel =
    mode === "verify" ? t`Verify` : mode === "login" ? t`Log in` : t`Register`;
  const canSubmit =
    mode === "verify"
      ? code.trim().length > 0
      : password.length > 0 && (!needsEmail || email.trim() !== "");
  const failure = isUnencodable
    ? t`Use only Latin characters in the password`
    : claim?.failure && failureText(claim.failure);

  return (
    <form
      aria-label={t`Your nick`}
      onSubmit={submit}
      className="strip-card border-discord-primary/35 bg-discord-primary/10"
    >
      <div className="strip-header">
        <FaUserCheck className="mt-0.5 shrink-0 text-discord-primary" />
        <span className="flex-1 min-w-0 break-words">{title}</span>
        <button
          type="button"
          onClick={() => useStore.getState().hideNickPrompt(server.id)}
          title={t`Hide`}
          aria-label={t`Hide`}
          className={`shrink-0 flex items-center justify-center rounded text-discord-text-muted hover:text-white ${isTouch ? "w-11 h-11 -m-2.5" : "w-5 h-5"}`}
        >
          <FaTimes />
        </button>
      </div>
      {mode === "verify" ? (
        <TextInput
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t`Code`}
          autoComplete="one-time-code"
          className="strip-field"
        />
      ) : (
        <>
          {needsEmail && (
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t`Email`}
              autoComplete="email"
              className="strip-field"
            />
          )}
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t`Password`}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            className="strip-field"
          />
        </>
      )}
      {failure && (
        <span role="alert" className="text-xs text-discord-red">
          {failure}
        </span>
      )}
      <button
        type="submit"
        disabled={!canSubmit || isSending}
        className="strip-action button-primary self-start"
      >
        {submitLabel}
      </button>
    </form>
  );
};

export default NickClaimStrip;
