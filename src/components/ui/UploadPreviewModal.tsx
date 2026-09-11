import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { formatFileSize } from "../../lib/mediaUpload";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";

interface UploadPreviewModalProps {
  isOpen: boolean;
  files: File[];
  previewUrl: string | null;
  target: string;
  onCancel: () => void;
  onUpload: () => void;
}

// Every path that picks a file routes here: a send cannot be taken back.
export function UploadPreviewModal({
  isOpen,
  files,
  previewUrl,
  target,
  onCancel,
  onUpload,
}: UploadPreviewModalProps) {
  if (files.length === 0) return null;

  const isImage = !!previewUrl && files[0].type.startsWith("image/");
  const isAudio = !!previewUrl && files[0].type.startsWith("audio/");
  const isVideo = !!previewUrl && files[0].type.startsWith("video/");

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title={
        isImage
          ? t`Upload Image`
          : isAudio
            ? t`Send Voice Message`
            : isVideo
              ? t`Send Video`
              : t`Upload Files`
      }
      maxWidth="md"
    >
      <ModalBody>
        {isImage && (
          <div className="flex justify-center mb-4">
            <img
              src={previewUrl}
              alt={files[0].name}
              className="max-w-full max-h-96 rounded-lg"
            />
          </div>
        )}
        {isAudio && (
          <div className="flex justify-center mb-4">
            {/* biome-ignore lint/a11y/useMediaCaption: a voice message has no captions to attach */}
            <audio controls src={previewUrl} className="w-full" />
          </div>
        )}
        {isVideo && (
          <div className="flex justify-center mb-4">
            {/* biome-ignore lint/a11y/useMediaCaption: a recorded clip has no captions to attach */}
            <video
              controls
              src={previewUrl}
              className="max-w-full max-h-96 rounded-lg"
            />
          </div>
        )}
        <p className="mb-2 text-sm text-discord-text-normal">
          <Trans>Upload to the file host and send to {target}.</Trans>
        </p>
        <ul className="text-sm text-discord-text-muted space-y-1">
          {files.map((file) => (
            <li
              className="truncate"
              key={`${file.name}-${file.size}-${file.lastModified}`}
            >
              {file.name} ({formatFileSize(file.size)})
            </li>
          ))}
        </ul>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="primary" onClick={onUpload}>
          <Trans>Upload</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}
