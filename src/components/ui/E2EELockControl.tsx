import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaLock, FaLockOpen, FaShieldAlt } from "react-icons/fa";
import { e2eeSessionKey, isWithholding } from "../../lib/e2ee/session";
import useStore from "../../store";
import HeaderOverflowMenu, {
  type HeaderOverflowMenuItem,
} from "./HeaderOverflowMenu";

// The single encryption affordance for a private chat. Driven entirely by the
// session reducer status (scheme-agnostic), so it serves both the Obby-native
// and OTR backends. Starting encryption is an explicit choice between the two
// schemes: a security feature shouldn't hide which guarantees are in force, and
// each interoperates with different peers. The dropdown reuses the shared
// HeaderOverflowMenu so it matches the rest of the header's menus.
const E2EELockControl: React.FC<{ serverId: string; nick: string }> = ({
  serverId,
  nick,
}) => {
  const { t } = useLingui();
  const session = useStore(
    (s) => s.e2eeSessions[e2eeSessionKey(serverId, nick)],
  );
  const status = session?.status ?? "none";
  const verified = session?.status === "established" && session.verified;
  const connected = useStore(
    (s) => !!s.servers.find((server) => server.id === serverId)?.isConnected,
  );
  const startE2EESession = useStore((s) => s.startE2EESession);
  const acceptE2EEOffer = useStore((s) => s.acceptE2EEOffer);
  const rejectE2EEOffer = useStore((s) => s.rejectE2EEOffer);
  const resetE2EESession = useStore((s) => s.resetE2EESession);
  const openE2EEVerify = useStore((s) => s.openE2EEVerify);
  const resumeE2EEIfKnown = useStore((s) => s.resumeE2EEIfKnown);

  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // Conversations already offered a resume, so ending a session by hand does
  // not read as "no session yet" and pull the lock straight back on.
  const resumedRef = useRef<string | null>(null);

  // Session keys live only in memory, so opening a conversation the user has
  // already encrypted with finds the lock off after every reload. Offering
  // again here is what makes the lock stick to the peer rather than to the tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    const conversation = e2eeSessionKey(serverId, nick);
    if (!connected || status !== "none") return;
    if (resumedRef.current === conversation) return;
    resumedRef.current = conversation;
    resumeE2EEIfKnown(serverId, nick);
  }, [connected, status, serverId, nick]);

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
        className="p-2 text-blue-400 hover:text-discord-text-normal md:p-0"
        onClick={() => resetE2EESession(serverId, nick)}
        aria-label={t`Cancel encryption`}
        title={t`Encrypting… (click to cancel)`}
      >
        <FaLock className="animate-pulse" />
      </button>
    );
  }

  const established = status === "established";
  const keyChanged = status === "key-changed";
  const locked = established || keyChanged;

  const menuItems: HeaderOverflowMenuItem[] = locked
    ? [
        {
          id: "verify",
          // Reachable while the key is changed too: that is the state where
          // comparing fingerprints matters most, and it is the only route to
          // accepting the new key.
          label: keyChanged ? (
            <Trans>Review changed key…</Trans>
          ) : (
            <Trans>Verify fingerprint…</Trans>
          ),
          icon: <FaShieldAlt />,
          show: true,
          onClick: () => openE2EEVerify(serverId, nick),
        },
        {
          id: "end",
          label: <Trans>End encryption</Trans>,
          icon: <FaLockOpen />,
          show: true,
          onClick: () => resetE2EESession(serverId, nick),
        },
      ]
    : [
        {
          // A session that broke after it was live still withholds every send,
          // and the notice tells the user to end encryption. Without this the
          // instruction points at a control that only the locked menu carries.
          id: "end",
          label: <Trans>End encryption</Trans>,
          icon: <FaLockOpen />,
          show: isWithholding(session),
          onClick: () => resetE2EESession(serverId, nick),
        },
        {
          id: "obby",
          label: (
            <span>
              <Trans>Encrypt (Obby)</Trans>
              <span className="block text-xs text-discord-text-muted">
                <Trans>Strongest, but only with other Obby users</Trans>
              </span>
            </span>
          ),
          icon: <FaLock className="text-discord-green" />,
          show: true,
          onClick: () => startE2EESession(serverId, nick, "obby"),
        },
        {
          id: "otr",
          label: (
            <span>
              <Trans>Encrypt (OTR)</Trans>
              <span className="block text-xs text-discord-text-muted">
                <Trans>Works with other IRC clients</Trans>
              </span>
            </span>
          ),
          icon: <FaShieldAlt />,
          show: true,
          onClick: () => startE2EESession(serverId, nick, "otr"),
        },
      ];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`p-2 hover:text-discord-text-normal md:p-0 ${
          established ? "text-discord-green" : keyChanged ? "text-red-400" : ""
        }`}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={locked ? t`Encryption options` : t`Encrypt this chat`}
        title={
          verified
            ? t`Encrypted & verified`
            : established
              ? t`Encrypted, not verified`
              : keyChanged
                ? t`Encryption key changed`
                : t`Encrypt this chat`
        }
      >
        {verified ? <FaShieldAlt /> : locked ? <FaLock /> : <FaLockOpen />}
      </button>
      <HeaderOverflowMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        menuItems={menuItems}
        anchorElement={anchorRef.current}
      />
    </>
  );
};

export default E2EELockControl;
