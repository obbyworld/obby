import { t } from "@lingui/core/macro";
import type React from "react";
import { useState } from "react";
import ircClient from "../../lib/ircClient";
import { Button } from "../../lib/modal/components";
import useStore from "../../store";
import { getLoginState } from "../../store/helpers";
import type { NickClaim, Server } from "../../types";
import { SettingGroup, SettingRow } from "../ui/page/SettingRow";
import { TextInput } from "../ui/TextInput";

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

const isEmailRequired = (server: Server): boolean =>
  server.capabilityValues?.["draft/account-registration"]
    ?.split(",")
    .includes("email-required") ?? false;

export const RegisterAccountSection: React.FC<{ server: Server }> = ({
  server,
}) => {
  // The store updates on every NICK, so this selector sees our new nick.
  const nick = useStore(() => ircClient.getNick(server.id));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isUnencodable, setIsUnencodable] = useState(false);

  const claim = server.nickClaim;
  if (
    !nick ||
    !server.capabilities?.includes("draft/account-registration") ||
    server.registeredNick?.toLowerCase() === nick.toLowerCase() ||
    (getLoginState(server) !== "guest" && !claim)
  )
    return null;

  const isVerifying = claim?.stage === "verify";
  const isSending = claim?.stage === "sending";
  const needsEmail = isEmailRequired(server);
  const failure = isUnencodable
    ? t`Use only Latin characters in the password`
    : claim?.failure && failureText(claim.failure);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { claimNick, verifyNickClaim } = useStore.getState();
    if (isVerifying) {
      verifyNickClaim(server.id, code.trim());
      return;
    }
    setIsUnencodable(
      !claimNick(server.id, nick, email.trim() || "*", password),
    );
  };

  return (
    <form className="contents" onSubmit={submit}>
      <SettingGroup title={t`Register`}>
        {isVerifying ? (
          <SettingRow
            id="server.registerCode"
            title={t`Code`}
            description={t`Enter the code sent to your email.`}
            field={
              <TextInput
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t`Code`}
                autoComplete="one-time-code"
                className="field-input"
              />
            }
          />
        ) : (
          <>
            {needsEmail && (
              <SettingRow
                id="server.registerEmail"
                title={t`Email`}
                field={
                  <TextInput
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t`Email`}
                    autoComplete="email"
                    className="field-input"
                  />
                }
              />
            )}
            <SettingRow
              id="server.registerPassword"
              title={t`Password`}
              description={t`Register ${nick} as your account on this server.`}
              field={
                <TextInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t`Password`}
                  autoComplete="new-password"
                  className="field-input"
                />
              }
            />
          </>
        )}
        <SettingRow
          title={
            failure && (
              <span role="alert" className="text-discord-red">
                {failure}
              </span>
            )
          }
          control={
            <Button
              type="submit"
              disabled={
                isSending ||
                (isVerifying
                  ? !code.trim()
                  : !password || (needsEmail && !email.trim()))
              }
            >
              {isVerifying ? t`Verify` : t`Register`}
            </Button>
          }
        />
      </SettingGroup>
    </form>
  );
};
