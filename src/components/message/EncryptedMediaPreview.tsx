import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { FaLock } from "react-icons/fa";
import {
  fetchDecryptedMedia,
  type MediaDescriptor,
  renderableMime,
  sanitizeFileName,
} from "../../lib/e2ee/media";

// Renders an attachment that exists on the filehost only as ciphertext. The
// bytes are fetched and decrypted here and handed to the player as a blob, so
// the file's URL stays out of the DOM and out of reach of the UI.
//
// `allowed` carries the same origin trust decision the plain media path makes:
// the descriptor URL is peer-authored, and fetching one the user has not
// trusted would hand a chosen host their IP.
export const EncryptedMediaPreview: React.FC<{
  descriptor: MediaDescriptor;
  allowed: boolean;
}> = ({ descriptor, allowed }) => {
  const { t } = useLingui();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The descriptor is rebuilt on every render of the owning row, so the effect
  // keys off the values it actually reads.
  const { url, k, n, mime, size } = descriptor;
  // A peer chooses this name and it is shown as the app's own copy, so control
  // and bidi characters (which can reverse a displayed extension) come out.
  const safeName = sanitizeFileName(descriptor.name);

  useEffect(() => {
    if (!allowed) return;
    const abort = new AbortController();
    let created: string | null = null;
    setObjectUrl(null);
    setFailed(false);

    fetchDecryptedMedia({ url, k, n, mime, size, name: "" }, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });

    return () => {
      abort.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [allowed, url, k, n, mime, size]);

  if (!allowed) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded border border-discord-dark-500 bg-discord-dark-300 px-3 py-2 text-sm text-discord-text-muted">
        <FaLock className="flex-shrink-0" />
        <Trans>
          Encrypted attachment from an untrusted host. Enable external content
          to open it.
        </Trans>
      </div>
    );
  }

  if (failed) {
    return (
      <div
        role="alert"
        className="mt-1 flex items-center gap-2 rounded border border-discord-dark-500 bg-discord-dark-300 px-3 py-2 text-sm text-discord-text-muted"
      >
        <FaLock className="flex-shrink-0" />
        <Trans>
          {safeName} couldn't be decrypted. The file may have expired or been
          changed on the server.
        </Trans>
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div
        role="status"
        className="mt-1 flex items-center gap-2 rounded border border-discord-dark-500 bg-discord-dark-300 px-3 py-2 text-sm text-discord-text-muted"
      >
        <FaLock className="flex-shrink-0 animate-pulse" />
        <Trans>Decrypting {safeName}…</Trans>
      </div>
    );
  }

  // The same value the blob was typed with, so a type this app refuses to
  // render never picks a media element to render into.
  const safeMime = renderableMime(descriptor.mime);
  const body = safeMime.startsWith("image/") ? (
    <img
      src={objectUrl}
      alt={safeName}
      className="max-h-96 rounded-lg object-contain"
    />
  ) : safeMime.startsWith("video/") ? (
    // biome-ignore lint/a11y/useMediaCaption: a peer's attachment has no track
    <video src={objectUrl} controls className="max-h-96 rounded-lg">
      <Trans>Your browser cannot play this video.</Trans>
    </video>
  ) : safeMime.startsWith("audio/") ? (
    // biome-ignore lint/a11y/useMediaCaption: a peer's attachment has no track
    <audio src={objectUrl} controls className="w-full">
      <Trans>Your browser cannot play this audio.</Trans>
    </audio>
  ) : (
    <a
      href={objectUrl}
      download={safeName}
      className="text-discord-blue hover:underline"
      title={t`Save the decrypted file`}
    >
      {safeName}
    </a>
  );

  return (
    <div className="mt-1 max-w-md">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-discord-text-muted">
        <FaLock className="text-discord-green" />
        <Trans>Encrypted attachment</Trans>
      </div>
      {body}
    </div>
  );
};

export default EncryptedMediaPreview;
