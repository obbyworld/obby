import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

export const TotpStepUpModal: React.FC = () => {
  const { t } = useLingui();
  const pending = useStore((s) => s.pendingTotpStepUp);
  const submitTotpStepUp = useStore((s) => s.submitTotpStepUp);
  const cancelTotpStepUp = useStore((s) => s.cancelTotpStepUp);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pending) {
      setCode("");
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pending]);

  if (!pending) return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError(t`Enter the 6-digit code from your authenticator app.`);
      return;
    }
    submitTotpStepUp(pending.serverId, trimmed);
  };

  return (
    <BaseModal
      isOpen
      onClose={() => cancelTotpStepUp(pending.serverId)}
      maxWidth="sm"
      title={t`Two-factor authentication required`}
    >
      <form onSubmit={onSubmit} className="flex flex-col min-h-0 flex-1">
        <ModalBody className="gap-3">
          <p className="text-sm text-discord-text-muted">
            {pending.account ? (
              <Trans>
                Enter the 6-digit code from your authenticator app to finish
                signing in as {pending.account}.
              </Trans>
            ) : (
              <Trans>
                Enter the 6-digit code from your authenticator app to finish
                signing in.
              </Trans>
            )}
          </p>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="\d{6}"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            className="w-full px-3 py-2 rounded bg-discord-dark-300 text-white tracking-[0.4em] text-center text-xl font-mono focus:outline-none focus:ring-2 focus:ring-discord-primary"
            placeholder="000000"
          />
          {error && <p className="text-discord-red text-xs">{error}</p>}
        </ModalBody>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => cancelTotpStepUp(pending.serverId)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" variant="primary">
            <Trans>Verify</Trans>
          </Button>
        </ModalFooter>
      </form>
    </BaseModal>
  );
};

export default TotpStepUpModal;
