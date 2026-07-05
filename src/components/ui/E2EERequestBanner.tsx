import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaExclamationTriangle, FaLock, FaShieldAlt } from "react-icons/fa";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import useStore from "../../store";

// In-context E2EE prompt shown above the message box for a private chat: lets
// the recipient accept/decline an incoming encryption request, shows the
// initiator they're waiting, and warns prominently on a peer key change. The
// header lock toggle starts a session; this is where the other side responds.
export const E2EERequestBanner: React.FC<{
  serverId: string;
  nick: string;
}> = ({ serverId, nick }) => {
  const session = useStore(
    (state) => state.e2eeSessions[e2eeSessionKey(serverId, nick)],
  );
  const acceptE2EEOffer = useStore((state) => state.acceptE2EEOffer);
  const rejectE2EEOffer = useStore((state) => state.rejectE2EEOffer);
  const resetE2EESession = useStore((state) => state.resetE2EESession);
  const openE2EEVerify = useStore((state) => state.openE2EEVerify);
  // Dismissal is tracked per conversation and per banner kind so dismissing the
  // verify nudge doesn't also silence a later encryption-failure notice for the
  // same peer (this banner is a single mounted instance reused across PMs).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const convKey = e2eeSessionKey(serverId, nick);
  const verifyKey = `${convKey}:verify`;
  const errorKey = `${convKey}:error`;

  if (!session) return null;

  if (session.status === "pending-accept") {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-md border border-discord-dark-500 bg-discord-dark-300 px-3 py-2">
        <FaLock className="flex-shrink-0 text-discord-green" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-discord-text-normal">
            <Trans>{nick} wants to start an encrypted chat</Trans>
          </div>
          {session.peerFingerprint && (
            <div className="truncate font-mono text-xs text-discord-text-muted">
              {session.peerFingerprint}
            </div>
          )}
        </div>
        <button
          type="button"
          className="rounded bg-discord-primary px-3 py-1 text-xs font-medium text-white hover:bg-discord-primary-hover"
          onClick={() => acceptE2EEOffer(serverId, nick)}
        >
          <Trans>Accept</Trans>
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs text-discord-text-muted hover:text-white"
          onClick={() => rejectE2EEOffer(serverId, nick)}
        >
          <Trans>Decline</Trans>
        </button>
      </div>
    );
  }

  if (session.status === "negotiating") {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-md bg-discord-dark-300 px-3 py-2 text-sm text-discord-text-muted">
        <FaLock className="flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <Trans>Encrypting with {nick}…</Trans>
        </span>
        <button
          type="button"
          className="px-2 py-1 text-xs text-discord-text-muted hover:text-white"
          onClick={() => resetE2EESession(serverId, nick)}
        >
          <Trans>Cancel</Trans>
        </button>
      </div>
    );
  }

  if (
    session.status === "established" &&
    !session.verified &&
    !dismissed.has(verifyKey)
  ) {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-md border border-discord-dark-500 bg-discord-dark-300 px-3 py-2">
        <FaShieldAlt className="flex-shrink-0 text-discord-green" />
        <div className="min-w-0 flex-1 text-sm text-discord-text-normal">
          <Trans>Encrypted — verify {nick}'s identity to be sure.</Trans>
        </div>
        <button
          type="button"
          className="rounded bg-discord-primary px-3 py-1 text-xs font-medium text-white hover:bg-discord-primary-hover"
          onClick={() => openE2EEVerify(serverId, nick)}
        >
          <Trans>Verify…</Trans>
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs text-discord-text-muted hover:text-white"
          onClick={() => setDismissed((d) => new Set(d).add(verifyKey))}
        >
          <Trans>Dismiss</Trans>
        </button>
      </div>
    );
  }

  if (session.status === "key-changed") {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-md border border-discord-red/50 bg-discord-dark-300 px-3 py-2">
        <FaExclamationTriangle className="flex-shrink-0 text-discord-red" />
        <div className="min-w-0 flex-1 text-sm text-discord-text-normal">
          <Trans>
            {nick}'s encryption key changed — this could be a new device or an
            attacker. End encryption and start again to re-verify.
          </Trans>
        </div>
        <button
          type="button"
          className="rounded bg-discord-red px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          onClick={() => resetE2EESession(serverId, nick)}
        >
          <Trans>End encryption</Trans>
        </button>
      </div>
    );
  }

  if (
    (session.status === "error" || session.status === "rejected") &&
    !dismissed.has(errorKey)
  ) {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-md border border-discord-dark-500 bg-discord-dark-300 px-3 py-2">
        <FaExclamationTriangle className="flex-shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1 text-sm text-discord-text-normal">
          {session.status === "rejected" ? (
            <Trans>{nick} declined encryption.</Trans>
          ) : (
            <Trans>
              Couldn't encrypt with {nick} — {session.reason}.
            </Trans>
          )}
        </div>
        <button
          type="button"
          className="px-2 py-1 text-xs text-discord-text-muted hover:text-white"
          onClick={() => setDismissed((d) => new Set(d).add(errorKey))}
        >
          <Trans>Dismiss</Trans>
        </button>
      </div>
    );
  }

  return null;
};
