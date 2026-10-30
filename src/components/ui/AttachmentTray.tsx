import { Trans, useLingui } from "@lingui/react/macro";
import {
  FaDownload,
  FaFile,
  FaMapMarkerAlt,
  FaTimes,
  FaTrash,
  FaTrashAlt,
} from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { formatFileSize } from "../../lib/mediaUpload";
import { saveFileToDevice } from "../../lib/saveFile";
import useStore from "../../store";
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
  cover,
}: {
  attachment: Extract<PendingAttachment, { kind: "file" }>;
  cover?: boolean;
}) {
  const fit = cover ? "object-cover" : "object-contain";
  const { file, previewUrl } = attachment;
  if (previewUrl && file.type.startsWith("image/")) {
    // A card shows the whole picture so a tall screenshot stays recognisable,
    // and a phone thumbnail fills its small square.
    return (
      <img
        src={previewUrl}
        alt={file.name}
        className={`h-full w-full ${fit}`}
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
    return <video src={previewUrl} className={`h-full w-full ${fit}`} muted />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-discord-text-muted">
      <FaFile className="h-8 w-8" />
    </div>
  );
}

// We tell the user when a save fails, so nobody removes a file they think they kept.
function saveAttachment(file: File, failedMessage: string) {
  saveFileToDevice(file).catch((error) => {
    console.error("Saving the attachment failed", error);
    useStore.getState().addGlobalNotification({
      type: "fail",
      command: "SAVE",
      code: "SAVE_FAILED",
      message: failedMessage,
      serverId: useStore.getState().ui.selectedServerId ?? "",
    });
  });
}

/** A phone keeps the composer small next to its keyboard, so each attachment
 *  is a thumbnail with its own remove and save badges. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: (id: string) => void;
}) {
  const { t } = useLingui();
  const isMedia =
    attachment.kind === "file" &&
    !!attachment.previewUrl &&
    /^(image|video)\//.test(attachment.file.type);
  const caption =
    attachment.kind === "file" ? attachment.file.name : attachment.label;

  return (
    <div
      className={`relative h-16 shrink-0 overflow-hidden rounded-lg bg-discord-dark-300 ${
        isMedia ? "w-16" : isAudio(attachment) ? "w-60" : "w-40"
      }`}
    >
      {attachment.kind === "file" && (isMedia || isAudio(attachment)) ? (
        <Thumbnail attachment={attachment} cover />
      ) : (
        <div className="flex h-full items-center gap-2 px-2 pr-7 text-xs text-discord-text-normal">
          {attachment.kind === "file" ? (
            <FaFile className="h-5 w-5 shrink-0 text-discord-text-muted" />
          ) : (
            <FaMapMarkerAlt className="h-5 w-5 shrink-0 text-discord-text-muted" />
          )}
          <span className="line-clamp-2 break-all">{caption}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={t`Remove attachment`}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
      >
        <FaTimes className="h-3 w-3" />
      </button>
      {attachment.kind === "file" && (
        <button
          type="button"
          onClick={() =>
            saveAttachment(attachment.file, t`Saving ${caption} failed`)
          }
          aria-label={t`Save file`}
          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
        >
          <FaDownload className="h-3 w-3" />
        </button>
      )}
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
      <div className="absolute right-3 top-3 flex items-center overflow-hidden rounded-md bg-discord-dark-200 shadow-lg ring-1 ring-black/40 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        {attachment.kind === "file" && (
          <button
            type="button"
            onClick={() =>
              saveAttachment(attachment.file, t`Saving ${caption} failed`)
            }
            aria-label={t`Save file`}
            title={t`Save file`}
            className="flex h-8 w-8 items-center justify-center text-discord-text-muted hover:bg-discord-dark-400 hover:text-discord-text-normal"
          >
            <FaDownload className="h-3.5 w-3.5" />
          </button>
        )}
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
  const isTouch = useIsTouchInput();
  const onRemoveAll = () => {
    for (const attachment of attachments) onRemove(attachment.id);
  };
  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="attachment-tray"
      className={`flex gap-2 overflow-x-auto px-3 ${isTouch ? "pt-2" : "pb-2 pt-3"}`}
    >
      {attachments.map((attachment) =>
        isTouch ? (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove}
          />
        ) : (
          <AttachmentCard
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove}
          />
        ),
      )}
      {!isTouch && attachments.length > 1 && (
        <ClearAllButton onClear={onRemoveAll} />
      )}
    </div>
  );
}

export default AttachmentTray;
