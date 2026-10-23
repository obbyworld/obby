// draft/account-recovery: forgot-password flow.
//
// Three-stage modal:
//   1. enter the account name -> server emails a 6-digit code
//   2. enter the code -> server replies NOTE RECOVER VERIFIED, opening
//      a setpass-grant on this connection
//   3. enter the new password -> we send SETPASS :<password>
//
// Spec note: the response to RECOVER REQUEST is identical regardless
// of whether the account exists / has a verified email.  We surface
// that ambiguity in the UI so the user isn't surprised when an obvious
// typo silently "works".

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";

interface Props {
  serverId: string;
  initialAccount?: string;
  onClose: () => void;
}

type Stage = "request" | "confirm" | "setpass" | "done";

export const PasswordRecoveryModal: React.FC<Props> = ({
  serverId,
  initialAccount,
  onClose,
}) => {
  const [stage, setStage] = useState<Stage>("request");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Subscribe to RECOVER + SETPASS events for this server.
  useEffect(() => {
    const onRecoverNote = (p: {
      serverId: string;
      code: string;
      args: string[];
    }) => {
      if (p.serverId !== serverId) return;
      if (p.code === "CODE_SENT") {
        setBusy(false);
        setStage("confirm");
        // args[0] = account; description follows in args[1] but the
        // raw NOTE handler stripped the leading ':'.  Recompose for UX.
        const accountName = p.args[0] ?? t`that account`;
        setInfo(
          p.args.slice(1).join(" ") ||
            t`If ${accountName} has a verified email on file, a code has been sent.`,
        );
      } else if (p.code === "VERIFIED") {
        setBusy(false);
        setStage("setpass");
        setInfo(p.args.slice(1).join(" ") || t`Code accepted.`);
      }
    };
    const onRecoverFail = (p: {
      serverId: string;
      code: string;
      message: string;
    }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setErr(p.message || t`Recovery failed: ${p.code}`);
    };
    const onSetpassNote = (p: {
      serverId: string;
      code: string;
      args: string[];
    }) => {
      if (p.serverId !== serverId) return;
      if (p.code === "SUCCESS") {
        setBusy(false);
        setStage("done");
        setInfo(
          p.args.slice(1).join(" ") || t`Password updated. You can now log in.`,
        );
      }
    };
    const onSetpassFail = (p: {
      serverId: string;
      code: string;
      message: string;
    }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setErr(p.message || t`Could not set the new password: ${p.code}`);
    };
    ircClient.on("RECOVER_NOTE", onRecoverNote);
    ircClient.on("RECOVER_FAIL", onRecoverFail);
    ircClient.on("SETPASS_NOTE", onSetpassNote);
    ircClient.on("SETPASS_FAIL", onSetpassFail);
    return () => {
      ircClient.deleteHook("RECOVER_NOTE", onRecoverNote);
      ircClient.deleteHook("RECOVER_FAIL", onRecoverFail);
      ircClient.deleteHook("SETPASS_NOTE", onSetpassNote);
      ircClient.deleteHook("SETPASS_FAIL", onSetpassFail);
    };
  }, [serverId]);

  const submitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    const acct = account.trim();
    if (!acct) {
      setErr(t`Enter the account name you want to recover.`);
      return;
    }
    setBusy(true);
    ircClient.recoverRequest(serverId, acct);
  };

  const submitConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setErr(t`Enter the 6-digit code from your email.`);
      return;
    }
    setBusy(true);
    ircClient.recoverConfirm(serverId, account.trim(), code.trim());
  };

  const submitSetpass = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (newPass.length < 3) {
      setErr(t`Pick a password (3 characters or more).`);
      return;
    }
    if (newPass !== confirmPass) {
      setErr(t`Passwords don't match.`);
      return;
    }
    setBusy(true);
    ircClient.setpass(serverId, newPass);
  };

  const submitStage =
    stage === "request"
      ? submitRequest
      : stage === "confirm"
        ? submitConfirm
        : submitSetpass;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      maxWidth="md"
      title={stage === "done" ? t`Password reset complete` : t`Forgot password`}
    >
      <form onSubmit={submitStage} className="flex flex-col min-h-0 flex-1">
        <ModalBody className="gap-3">
          {stage === "request" && (
            <>
              <p className="text-sm text-discord-text-muted">
                <Trans>
                  Enter your account name. We'll email a 6-digit recovery code
                  to the verified address on file.
                </Trans>
              </p>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={t`Account Name`}
                className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
                autoFocus
              />
            </>
          )}

          {stage === "confirm" && (
            <>
              <p className="text-sm text-white">{info}</p>
              <p className="text-xs text-discord-text-muted">
                <Trans>
                  Note: the server returns the same response whether or not the
                  account has a verified email, so a typo will not be flagged
                  here. If no code arrives within a couple of minutes,
                  double-check the account name.
                </Trans>
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white tracking-[0.4em] text-center font-mono"
                autoFocus
              />
            </>
          )}

          {stage === "setpass" && (
            <>
              <p className="text-sm text-white">{info}</p>
              <p className="text-xs text-discord-text-muted">
                <Trans>You have a few minutes to choose a new password.</Trans>
              </p>
              <input
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder={t`New password`}
                className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
                autoFocus
              />
              <input
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder={t`Confirm new password`}
                className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
              />
            </>
          )}

          {stage === "done" && (
            <>
              <p className="text-sm text-white">{info}</p>
              <p className="text-xs text-discord-text-muted">
                <Trans>
                  For security, all existing sessions for this account were
                  signed out and account-scoped server state was purged. If
                  two-factor authentication was enabled, it remains enabled, so
                  the next login will still require it.
                </Trans>
              </p>
            </>
          )}

          {err && <p className="text-discord-red text-xs">{err}</p>}
        </ModalBody>

        <ModalFooter>
          {stage === "request" && (
            <Button type="submit" disabled={busy}>
              {busy ? t`Sending…` : t`Send recovery code`}
            </Button>
          )}
          {stage === "confirm" && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setStage("request");
                  setCode("");
                  setErr(null);
                }}
              >
                <Trans>Back</Trans>
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t`Verifying…` : t`Verify code`}
              </Button>
            </>
          )}
          {stage === "setpass" && (
            <Button type="submit" disabled={busy}>
              {busy ? t`Setting…` : t`Set new password`}
            </Button>
          )}
          {stage === "done" && (
            <Button onClick={onClose}>
              <Trans>Done</Trans>
            </Button>
          )}
        </ModalFooter>
      </form>
    </BaseModal>
  );
};

export default PasswordRecoveryModal;
