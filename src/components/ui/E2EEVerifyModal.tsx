import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaCheck, FaCopy, FaShieldAlt } from "react-icons/fa";
import { formatOtrFingerprint } from "../../lib/e2ee/otr/identity";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

interface E2EEVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  nick: string;
}

// Fingerprint-comparison panel for an established session: shows both parties'
// long-term fingerprints so the user can confirm them out of band (a call, a
// trusted channel, in person) and mark the peer verified. This is the defence
// against a man-in-the-middle for both schemes; OTR fingerprints match what
// Pidgin/irssi display, so they can be read across clients.
const E2EEVerifyModal: React.FC<E2EEVerifyModalProps> = ({
  isOpen,
  onClose,
  serverId,
  nick,
}) => {
  const { t } = useLingui();
  const session = useStore(
    (s) => s.e2eeSessions[e2eeSessionKey(serverId, nick)],
  );
  const obbySelf = useStore((s) => s.e2eeSelfFingerprint);
  const otrSelf = useStore((s) => s.e2eeOtrSelfFingerprint);
  const verifyE2EESession = useStore((s) => s.verifyE2EESession);
  const [copied, setCopied] = useState(false);

  if (session?.status !== "established") return null;

  const isOtr = session.scheme === "otr";
  const selfRaw = (isOtr ? otrSelf : obbySelf) ?? "";
  const peerRaw = session.peerFingerprint;
  const selfFp = isOtr ? formatOtrFingerprint(selfRaw) : selfRaw;
  const peerFp = isOtr ? formatOtrFingerprint(peerRaw) : peerRaw;

  const copyPeer = () => {
    navigator.clipboard.writeText(peerRaw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <FaShieldAlt className="flex-shrink-0 text-discord-green" />
          <span>
            <Trans>Verify encryption</Trans>
          </span>
        </div>
      }
      maxWidth="md"
    >
      <ModalBody>
        <div className="space-y-4">
          <p className="text-sm text-discord-text-muted">
            {isOtr ? (
              <Trans>
                This chat is encrypted with OTR, compatible with other IRC
                clients. Compare the fingerprints out of band, then mark it
                verified.
              </Trans>
            ) : (
              <Trans>
                This chat is encrypted with Obby's native scheme. Compare the
                fingerprints out of band, then mark it verified.
              </Trans>
            )}
          </p>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-discord-text-muted">
              <Trans>Your fingerprint</Trans>
            </div>
            <code className="block break-all rounded bg-discord-dark-400 p-3 font-mono text-sm text-discord-text-normal">
              {selfFp || "—"}
            </code>
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-discord-text-muted">
              <Trans>{nick}'s fingerprint</Trans>
            </div>
            <div className="flex items-center gap-2 rounded bg-discord-dark-400 p-3">
              <code className="flex-1 break-all font-mono text-sm text-discord-text-normal">
                {peerFp || "—"}
              </code>
              <button
                type="button"
                aria-label={copied ? t`Copied` : t`Copy fingerprint`}
                onClick={copyPeer}
                className="shrink-0 rounded p-1.5 text-discord-text-muted hover:bg-discord-dark-300 hover:text-discord-text-normal"
              >
                {copied ? (
                  <FaCheck className="text-discord-green" />
                ) : (
                  <FaCopy />
                )}
              </button>
            </div>
          </div>

          {session.verified && (
            <div className="flex items-center gap-2 text-sm text-discord-green">
              <FaCheck className="flex-shrink-0" />
              <Trans>You verified this contact.</Trans>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
        {!session.verified && (
          <Button
            variant="primary"
            onClick={() => {
              verifyE2EESession(serverId, nick);
              onClose();
            }}
          >
            <FaShieldAlt className="mr-2 inline text-sm" />
            <Trans>Mark as verified</Trans>
          </Button>
        )}
      </ModalFooter>
    </BaseModal>
  );
};

export default E2EEVerifyModal;
