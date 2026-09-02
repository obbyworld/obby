import type { Message } from "../../types";
import { decodeMediaDescriptor, type MediaDescriptor } from "./media";

// Marks a plaintext PM that arrived while an encrypted session was active. The
// message handler stamps this on receipt; the UI keys the amber highlight, the
// group break, and the lock indicator off this single flag.
export const E2EE_UNPROTECTED_TAG = "e2ee-unprotected";

export function isUnprotectedMessage(message: Pick<Message, "tags">): boolean {
  return message.tags?.[E2EE_UNPROTECTED_TAG] === "1";
}

// Carries an encrypted attachment's descriptor, including its file key. The
// renderer fetches and decrypts from this; the URL is deliberately never the
// message content, so it can't be rendered as a link to bytes that won't open.
// Messages are memory-only, which is what keeps the key off disk.
export const E2EE_MEDIA_TAG = "e2ee-media";

export function encryptedMediaOf(
  message: Pick<Message, "tags">,
): MediaDescriptor | null {
  const raw = message.tags?.[E2EE_MEDIA_TAG];
  return raw ? decodeMediaDescriptor(raw) : null;
}

// Marks a row whose text arrived through an encrypted session. A link in such a
// message travelled protected, but the file behind it did not: it sits on the
// filehost in the clear, readable by anyone holding the URL. Distinct from
// E2EE_MEDIA_TAG, which is a file encrypted before upload.
export const E2EE_SESSION_TAG = "e2ee-session";

export function isFromEncryptedSession(
  message: Pick<Message, "tags">,
): boolean {
  return message.tags?.[E2EE_SESSION_TAG] === "1";
}

// Marks replayed ciphertext from server history. Ratchet keys live only in
// memory, so a session that has ended can never decrypt its own history; the
// row is kept as a placeholder rather than dropped, which would read as the
// conversation having lost messages.
export const E2EE_UNDECRYPTABLE_TAG = "e2ee-undecryptable";

export function isUndecryptableMessage(
  message: Pick<Message, "tags">,
): boolean {
  return message.tags?.[E2EE_UNDECRYPTABLE_TAG] === "1";
}

// Advisory system rows the E2EE layer injects (e.g. a withheld send) carry this
// tag so the renderer styles them as a warning instead of a plain notice.
export const E2EE_NOTICE_TAG = "e2ee-notice";

export function isE2EEWarningNotice(message: Pick<Message, "tags">): boolean {
  return message.tags?.[E2EE_NOTICE_TAG] === "warning";
}
