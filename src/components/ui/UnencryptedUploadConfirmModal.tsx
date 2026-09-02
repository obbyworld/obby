import { Trans } from "@lingui/react/macro";
import type React from "react";
import { FaExclamationTriangle, FaLockOpen } from "react-icons/fa";
import {
  MAX_ENCRYPTABLE_BYTES,
  type PlainUploadReason,
} from "../../lib/e2ee/media";
import { formatFileSize } from "../../lib/mediaUpload";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";

interface UnencryptedUploadConfirmModalProps {
  isOpen: boolean;
  files: File[];
  nick: string;
  reason: PlainUploadReason;
  onConfirm: () => void;
  onCancel: () => void;
}

const UnencryptedUploadConfirmModal: React.FC<
  UnencryptedUploadConfirmModalProps
> = ({ isOpen, files, nick, reason, onConfirm, onCancel }) => {
  const affected =
    reason === "scheme"
      ? files
      : files.filter((f) => f.size > MAX_ENCRYPTABLE_BYTES);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title={
        <div className="flex items-center gap-3">
          <FaExclamationTriangle className="text-yellow-500 text-xl flex-shrink-0" />
          <span>
            <Trans>Send this file unencrypted?</Trans>
          </span>
        </div>
      }
      maxWidth="md"
    >
      <ModalBody>
        <div className="space-y-4">
          <p className="text-discord-text-normal">
            {reason === "scheme" ? (
              <Trans>
                Your messages with {nick} are encrypted with OTR, which carries
                text only. These files would be sent in the clear.
              </Trans>
            ) : affected.length === files.length ? (
              <Trans>
                Your messages with {nick} are encrypted. These files are too
                large to encrypt and would be sent in the clear.
              </Trans>
            ) : (
              <Trans>
                Your messages with {nick} are encrypted. {affected.length} of{" "}
                {files.length} files are too large to encrypt and would be sent
                in the clear. The rest stay encrypted.
              </Trans>
            )}
          </p>

          <div className="flex flex-col gap-2">
            {affected.map((file) => (
              <div
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-3 px-3 py-2 rounded bg-discord-dark-400"
              >
                <FaLockOpen className="text-yellow-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{file.name}</div>
                  <div className="text-xs text-discord-text-muted">
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-yellow-500 bg-opacity-10 border border-yellow-500 border-opacity-30 rounded p-3">
            <p className="text-sm text-yellow-200">
              {reason === "scheme" ? (
                <Trans>
                  The file host stores it readable, and anyone who obtains the
                  link can open it. Switch to Obby encryption to send files
                  encrypted.
                </Trans>
              ) : (
                <Trans>
                  Files above {formatFileSize(MAX_ENCRYPTABLE_BYTES)} are sent
                  as-is. The file host stores it readable, and anyone who
                  obtains the link can open it.
                </Trans>
              )}
            </p>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          <Trans>Send unencrypted</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default UnencryptedUploadConfirmModal;
