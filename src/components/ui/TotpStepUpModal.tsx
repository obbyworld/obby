import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
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
      // Autofocus once the modal mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pending]);

  if (!pending) return null;
  const account = pending.account;

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
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100002]"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-discord-dark-200 rounded-lg w-full max-w-sm p-5">
        <h2 className="text-lg font-semibold mb-2 text-white">
          <Trans>Two-factor authentication required</Trans>
        </h2>
        <p className="text-sm text-discord-text-muted mb-4">
          {account ? (
            <Trans>
              Enter the 6-digit code from your authenticator app to finish
              signing in as {account}.
            </Trans>
          ) : (
            <Trans>
              Enter the 6-digit code from your authenticator app to finish
              signing in.
            </Trans>
          )}
        </p>
        <form onSubmit={onSubmit}>
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
          {error && <p className="text-discord-red text-xs mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => cancelTotpStepUp(pending.serverId)}
              className="px-3 py-2 rounded text-sm text-discord-text-muted hover:text-white"
            >
              <Trans>Cancel</Trans>
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded button-primary text-sm font-medium"
            >
              <Trans>Verify</Trans>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TotpStepUpModal;
