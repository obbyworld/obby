import { useEffect, useState } from "react";
import { getDecryptedObjectUrl } from "../lib/e2ee/decryptedMediaCache";
import {
  type MediaDescriptor,
  type MediaFailure,
  MediaFetchError,
} from "../lib/e2ee/media";

// Hand back a blob URL for an encrypted attachment, so the file's own URL stays
// out of the DOM. The URL comes from the shared cache, which means a row that
// scrolls away and back, or a second view of the same file, costs nothing.
//
// `allowed` carries the same origin trust decision the plain media path makes:
// the descriptor URL is peer-authored, and fetching one the user has not
// trusted would hand a chosen host their IP.
export function useDecryptedMedia(
  descriptor: MediaDescriptor,
  allowed: boolean,
): { objectUrl: string | null; failure: MediaFailure | null } {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<MediaFailure | null>(null);
  // The descriptor is rebuilt on every render of the owning row, so the effect
  // keys off the values it actually reads.
  const { url, k, n, mime, size } = descriptor;

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setObjectUrl(null);
    setFailure(null);

    getDecryptedObjectUrl({ url, k, n, mime, size, name: "" })
      .then((cached) => {
        if (live) setObjectUrl(cached);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setFailure(err instanceof MediaFetchError ? err.reason : "unavailable");
      });

    // The URL belongs to the cache, so it is not revoked here.
    return () => {
      live = false;
    };
  }, [allowed, url, k, n, mime, size]);

  return { objectUrl, failure };
}
