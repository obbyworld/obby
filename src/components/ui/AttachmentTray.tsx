import { Trans, useLingui } from "@lingui/react/macro";
import { FaFile, FaMapMarkerAlt, FaTrash, FaTrashAlt } from "react-icons/fa";
import { formatFileSize } from "../../lib/mediaUpload";
import HoverTooltip from "./HoverTooltip";

/** Something waiting above the composer to go out with the next message. A
 *  file still has to be uploaded; a link is already final. */
export type PendingAttachment =
  | { id: string; kind: "file"; file: File; previewUrl: string | null }
  | { id: string; kind: "link"; url: string; label: string };

/** A player needs room a thumbnail does not, so an audio card is wider. */
function isAudio(attachment: PendingAttachment): boolean {
  return (
    attachment.kind === "file" && attachment.file.type.startsWith("audio/")
  );
}

function Thumbnail({
  attachment,
}: {
  attachment: Extract<PendingAttachment, { kind: "file" }>;
}) {
  const { file, previewUrl } = attachment;
  if (previewUrl && file.type.startsWith("image/")) {
    // Contained rather than cropped, so a tall screenshot is still recognisable
    // as the thing that was picked.
    return (
      <img
        src={previewUrl}
        alt={file.name}
        className="h-full w-full object-contain"
      />
    );
  }
  if (previewUrl && file.type.startsWith("audio/")) {
    return (
      <div className="flex h-full w-full items-center px-3">
        {/* biome-ignore lint/a11y/useMediaCaption: a voice message has no captions to attach */}
        <audio src={previewUrl} controls className="w-full" />
      </div>
    );
  }
  if (previewUrl && file.type.startsWith("video/")) {
    return (
      <video src={previewUrl} className="h-full w-full object-contain" muted />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-discord-text-muted">
      <FaFile className="h-8 w-8" />
    </div>
  );
}

function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: (id: string) => void;
}) {
  const { t } = useLingui();
  const caption =
    attachment.kind === "file" ? attachment.file.name : attachment.label;

  return (
    <div
      className={`group relative shrink-0 rounded-lg bg-discord-dark-300 p-2 ${
        isAudio(attachment) ? "w-64" : "w-48"
      }`}
    >
      <div className="h-40 overflow-hidden rounded bg-black/25">
        {attachment.kind === "file" ? (
          <Thumbnail attachment={attachment} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-discord-text-muted">
            <FaMapMarkerAlt className="h-8 w-8" />
          </div>
        )}
      </div>
      <p
        className="mt-2 truncate text-sm text-discord-text-normal"
        title={
          attachment.kind === "file"
            ? `${attachment.file.name} (${formatFileSize(attachment.file.size)})`
            : caption
        }
      >
        {caption}
      </p>
      {/* A pointer can ask for these by hovering; a finger has nothing to hover
          with, so there they stay out. */}
      <div className="absolute right-3 top-3 flex items-center overflow-hidden rounded-md bg-discord-dark-200 shadow-lg ring-1 ring-black/40 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={t`Remove attachment`}
          className="flex h-8 w-8 items-center justify-center text-discord-text-muted hover:bg-discord-dark-400 hover:text-red-400"
        >
          <FaTrash className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ClearAllButton({ onClear }: { onClear: () => void }) {
  const { t } = useLingui();
  return (
    <HoverTooltip content={<Trans>remove every attachment</Trans>}>
      <button
        type="button"
        onClick={onClear}
        aria-label={t`remove every attachment`}
        className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-lg bg-discord-dark-300 text-discord-text-muted transition-colors hover:bg-discord-dark-400 hover:text-red-400"
      >
        <FaTrashAlt className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}

/** The strip of things queued for the next message. Nothing here has left the
 *  device yet, so removing an item is the whole undo. */
export function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const onRemoveAll = () => {
    for (const attachment of attachments) onRemove(attachment.id);
  };
  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="attachment-tray"
      className="flex gap-2 overflow-x-auto px-3 pb-2 pt-3"
    >
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
      {attachments.length > 1 && <ClearAllButton onClear={onRemoveAll} />}
    </div>
  );
}

export default AttachmentTray;
