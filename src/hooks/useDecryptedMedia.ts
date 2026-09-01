import { useEffect, useState } from "react";
import {
  fetchDecryptedMedia,
  type MediaDescriptor,
  type MediaFailure,
  MediaFetchError,
} from "../lib/e2ee/media";

// Fetch an encrypted attachment and hand back a blob URL that lives exactly as
// long as the component holding it, so the file's own URL stays out of the DOM.
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
    const abort = new AbortController();
    let created: string | null = null;
    setObjectUrl(null);
    setFailure(null);

    fetchDecryptedMedia({ url, k, n, mime, size, name: "" }, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setFailure(err instanceof MediaFetchError ? err.reason : "unavailable");
      });

    return () => {
      abort.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [allowed, url, k, n, mime, size]);

  return { objectUrl, failure };
}
