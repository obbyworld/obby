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

import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";

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
        setInfo(
          p.args.slice(1).join(" ") ||
            `If ${p.args[0] ?? "that account"} has a verified email on file, a code has been sent.`,
        );
      } else if (p.code === "VERIFIED") {
        setBusy(false);
        setStage("setpass");
        setInfo(p.args.slice(1).join(" ") || "Code accepted.");
      }
    };
    const onRecoverFail = (p: {
      serverId: string;
      code: string;
      message: string;
    }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setErr(p.message || `Recovery failed: ${p.code}`);
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
          p.args.slice(1).join(" ") || "Password updated.  You can now log in.",
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
      setErr(p.message || `SETPASS failed: ${p.code}`);
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
      setErr("Enter the account name you want to recover.");
      return;
    }
    setBusy(true);
    ircClient.recoverRequest(serverId, acct);
  };

  const submitConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setErr("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    ircClient.recoverConfirm(serverId, account.trim(), code.trim());
  };

  const submitSetpass = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (newPass.length < 3) {
      setErr("Pick a password (3 characters or more).");
      return;
    }
    if (newPass !== confirmPass) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    ircClient.setpass(serverId, newPass);
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-discord-dark-200 rounded-lg w-full max-w-md p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">
            {stage === "done" ? "Password reset complete" : "Forgot password"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-discord-text-muted hover:text-white"
          >
            ✕
          </button>
        </div>

        {stage === "request" && (
          <form onSubmit={submitRequest} className="space-y-3">
            <p className="text-sm text-discord-text-muted">
              Enter your account name. We'll email a 6-digit recovery code to
              the verified address on file.
            </p>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Account name"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
              autoFocus
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full px-3 py-2 rounded bg-discord-blue text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send recovery code"}
            </button>
          </form>
        )}

        {stage === "confirm" && (
          <form onSubmit={submitConfirm} className="space-y-3">
            <p className="text-sm text-white">{info}</p>
            <p className="text-xs text-discord-text-muted">
              Note: the server returns the same response whether or not the
              account has a verified email, so a typo will not be flagged here.
              If no code arrives within a couple of minutes, double-check the
              account name.
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStage("request");
                  setCode("");
                  setErr(null);
                }}
                className="px-3 py-2 rounded bg-discord-dark-100 text-white text-sm"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 px-3 py-2 rounded bg-discord-blue text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Verify code"}
              </button>
            </div>
          </form>
        )}

        {stage === "setpass" && (
          <form onSubmit={submitSetpass} className="space-y-3">
            <p className="text-sm text-white">{info}</p>
            <p className="text-xs text-discord-text-muted">
              You have a few minutes to choose a new password.
            </p>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="New password"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
              autoFocus
            />
            <input
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="Confirm new password"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full px-3 py-2 rounded bg-discord-green text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Setting…" : "Set new password"}
            </button>
          </form>
        )}

        {stage === "done" && (
          <div className="space-y-3">
            <p className="text-sm text-white">{info}</p>
            <p className="text-xs text-discord-text-muted">
              For security, all existing sessions for this account were signed
              out and account-scoped server state was purged. If two-factor
              authentication was enabled, it remains enabled — the next login
              will still require it.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-3 py-2 rounded bg-discord-blue text-white text-sm font-medium"
            >
              Done
            </button>
          </div>
        )}

        {err && <p className="text-discord-red text-xs mt-3">{err}</p>}
      </div>
    </div>
  );
};

export default PasswordRecoveryModal;
