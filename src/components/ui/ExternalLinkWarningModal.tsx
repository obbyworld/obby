import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaCheck, FaCopy, FaExternalLinkAlt } from "react-icons/fa";
import { ConfirmDialog } from "../../lib/modal/ConfirmDialog";

interface ExternalLinkWarningModalProps {
  isOpen: boolean;
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ExternalLinkWarningModal: React.FC<ExternalLinkWarningModalProps> = ({
  isOpen,
  url,
  onConfirm,
  onCancel,
}) => {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Truncate very long URLs for display
  const displayUrl = url.length > 80 ? `${url.substring(0, 80)}...` : url;

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={<Trans>External Link Warning</Trans>}
      confirmLabel={
        <>
          <FaExternalLinkAlt className="inline text-sm" />
          <Trans>Open Link</Trans>
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="space-y-4">
        <p className="text-discord-text-normal">
          <Trans>You are about to open an external link:</Trans>
        </p>

        <div className="bg-discord-dark-400 rounded p-3 break-all flex items-center gap-2">
          <code className="text-sm text-discord-text-link flex-1">
            {displayUrl}
          </code>
          <button
            type="button"
            aria-label={copied ? t`Copied` : t`Copy URL`}
            onClick={handleCopy}
            className="shrink-0 p-1.5 rounded text-discord-text-muted hover:text-discord-text-normal hover:bg-discord-dark-300 transition-colors"
          >
            {copied ? <FaCheck className="text-green-400" /> : <FaCopy />}
          </button>
        </div>

        <div className="bg-yellow-500 bg-opacity-10 border border-yellow-500 border-opacity-30 rounded p-3">
          <p className="text-sm text-yellow-200">
            <Trans>
              <strong>⚠️ Be careful!</strong> Only open links from trusted
              sources. Malicious links can compromise your security or privacy.
            </Trans>
          </p>
        </div>

        <p className="text-sm text-discord-text-normal">
          <Trans>Do you want to open this link in a new tab?</Trans>
        </p>
      </div>
    </ConfirmDialog>
  );
};

export default ExternalLinkWarningModal;
