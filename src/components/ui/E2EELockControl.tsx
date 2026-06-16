import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaLock, FaLockOpen, FaShieldAlt } from "react-icons/fa";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import useStore from "../../store";
import LoadingSpinner from "./LoadingSpinner";

// The single encryption affordance for a private chat. Driven entirely by the
// session reducer status (scheme-agnostic), so it serves both the Obby-native
// and OTR backends. Starting encryption is an explicit choice between the two
// schemes — a security feature shouldn't hide which guarantees are in force, and
// each interoperates with different peers.
const E2EELockControl: React.FC<{ serverId: string; nick: string }> = ({
  serverId,
  nick,
}) => {
  const { t } = useLingui();
  const status = useStore(
    (s) => s.e2eeSessions[e2eeSessionKey(serverId, nick)]?.status ?? "none",
  );
  const startE2EESession = useStore((s) => s.startE2EESession);
  const acceptE2EEOffer = useStore((s) => s.acceptE2EEOffer);
  const rejectE2EEOffer = useStore((s) => s.rejectE2EEOffer);
  const resetE2EESession = useStore((s) => s.resetE2EESession);
  const openE2EEVerify = useStore((s) => s.openE2EEVerify);

  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Obby offers gate on explicit consent; OTR auto-establishes (no accept step),
  // so this branch only ever fires for the Obby scheme.
  if (status === "pending-accept") {
    return (
      <>
        <button
          type="button"
          className="p-2 text-discord-green hover:text-discord-text-normal md:p-0"
          onClick={() => acceptE2EEOffer(serverId, nick)}
          aria-label={t`Accept encrypted chat`}
          title={t`Accept encrypted chat`}
        >
          <FaShieldAlt />
        </button>
        <button
          type="button"
          className="p-2 hover:text-discord-text-normal md:p-0"
          onClick={() => rejectE2EEOffer(serverId, nick)}
          aria-label={t`Decline encryption`}
          title={t`Decline encryption`}
        >
          <FaLockOpen />
        </button>
      </>
    );
  }

  if (status === "negotiating") {
    return (
      <button
        type="button"
        disabled
        className="p-2 md:p-0"
        aria-label={t`Encrypting…`}
        title={t`Encrypting…`}
      >
        <LoadingSpinner size="sm" text="" />
      </button>
    );
  }

  const established = status === "established";
  const keyChanged = status === "key-changed";
  const locked = established || keyChanged;

  const itemClass =
    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-discord-text-normal hover:bg-discord-dark-200";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`p-2 hover:text-discord-text-normal md:p-0 ${
          established ? "text-discord-green" : keyChanged ? "text-red-400" : ""
        }`}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={locked ? t`Encryption options` : t`Encrypt this chat`}
        title={
          established
            ? t`Encrypted end-to-end`
            : keyChanged
              ? t`Encryption key changed — verify`
              : t`Encrypt this chat`
        }
      >
        {locked ? <FaLock /> : <FaLockOpen />}
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-md border border-discord-dark-500 bg-discord-dark-300 py-1 shadow-lg">
          {locked ? (
            <>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  openE2EEVerify(serverId, nick);
                  setMenuOpen(false);
                }}
              >
                <FaShieldAlt className="mt-0.5 flex-shrink-0" />
                <Trans>Verify fingerprint…</Trans>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  resetE2EESession(serverId, nick);
                  setMenuOpen(false);
                }}
              >
                <FaLockOpen className="mt-0.5 flex-shrink-0" />
                <Trans>End encryption</Trans>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  startE2EESession(serverId, nick, "obby");
                  setMenuOpen(false);
                }}
              >
                <FaLock className="mt-0.5 flex-shrink-0 text-discord-green" />
                <span>
                  <Trans>Encrypt (Obby)</Trans>
                  <span className="block text-xs text-discord-text-muted">
                    <Trans>Best — between Obby clients</Trans>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  startE2EESession(serverId, nick, "otr");
                  setMenuOpen(false);
                }}
              >
                <FaShieldAlt className="mt-0.5 flex-shrink-0" />
                <span>
                  <Trans>Encrypt (OTR)</Trans>
                  <span className="block text-xs text-discord-text-muted">
                    <Trans>Works with other IRC clients</Trans>
                  </span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default E2EELockControl;
