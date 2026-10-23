// In-session password rotation via SETPASS (draft/account-recovery).
//
// The user is already SASL-authenticated, so we don't need a recovery
// code -- the server accepts SETPASS on its own when the connection
// holds a SASL session for the target account.

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";

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
        setInfo(p.args.slice(1).join(" ") || t`Password updated.`);
      }
    };
    const onSetpassFail = (p: {
      serverId: string;
      code: string;
      message: string;
    }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setErr(p.message || t`Could not update password: ${p.code}`);
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

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      maxWidth="md"
      title={t`Change password`}
    >
      {!done ? (
        <form onSubmit={submit} className="flex flex-col min-h-0 flex-1">
          <ModalBody className="gap-3">
            <p className="text-xs text-discord-text-muted">
              <Trans>
                Other open sessions for this account will be signed out as part
                of the change. Two-factor authentication settings, if any, are
                left unchanged.
              </Trans>
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
            {err && <p className="text-discord-red text-xs">{err}</p>}
          </ModalBody>

          <ModalFooter>
            <Button type="submit" disabled={busy}>
              {busy ? t`Setting…` : t`Change password`}
            </Button>
          </ModalFooter>
        </form>
      ) : (
        <>
          <ModalBody className="gap-3">
            <p className="text-sm text-white">{info}</p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose}>
              <Trans>Done</Trans>
            </Button>
          </ModalFooter>
        </>
      )}
    </BaseModal>
  );
};

export default ChangePasswordModal;
