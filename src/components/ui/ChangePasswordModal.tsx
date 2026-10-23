// In-session password rotation via SETPASS (draft/account-recovery).
//
// The user is already SASL-authenticated, so we don't need a recovery
// code -- the server accepts SETPASS on its own when the connection
// holds a SASL session for the target account.

import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";

interface Props {
  serverId: string;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<Props> = ({ serverId, onClose }) => {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onSetpassNote = (p: {
      serverId: string;
      code: string;
      args: string[];
    }) => {
      if (p.serverId !== serverId) return;
      if (p.code === "SUCCESS") {
        setBusy(false);
        setDone(true);
        setInfo(p.args.slice(1).join(" ") || "Password updated.");
      }
    };
    const onSetpassFail = (p: {
      serverId: string;
      code: string;
      message: string;
    }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setErr(p.message || `Could not update password: ${p.code}`);
    };
    ircClient.on("SETPASS_NOTE", onSetpassNote);
    ircClient.on("SETPASS_FAIL", onSetpassFail);
    return () => {
      ircClient.deleteHook("SETPASS_NOTE", onSetpassNote);
      ircClient.deleteHook("SETPASS_FAIL", onSetpassFail);
    };
  }, [serverId]);

  const submit = (e: React.FormEvent) => {
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
          <h2 className="text-lg font-semibold text-white">Change password</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-discord-text-muted hover:text-white"
          >
            ✕
          </button>
        </div>

        {!done ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-discord-text-muted">
              Other open sessions for this account will be signed out as part of
              the change. Two-factor authentication settings, if any, are left
              unchanged.
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
              {busy ? "Setting…" : "Change password"}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-white">{info}</p>
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

export default ChangePasswordModal;
