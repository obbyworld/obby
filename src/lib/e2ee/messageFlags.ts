import type { Message } from "../../types";

// Marks a plaintext PM that arrived while an encrypted session was active. The
// message handler stamps this on receipt; the UI keys the amber highlight, the
// group break, and the lock indicator off this single flag.
export const E2EE_UNPROTECTED_TAG = "e2ee-unprotected";

export function isUnprotectedMessage(message: Pick<Message, "tags">): boolean {
  return message.tags?.[E2EE_UNPROTECTED_TAG] === "1";
}

// Advisory system rows the E2EE layer injects (e.g. a withheld send) carry this
// tag so the renderer styles them as a warning instead of a plain notice.
export const E2EE_NOTICE_TAG = "e2ee-notice";

export function isE2EEWarningNotice(message: Pick<Message, "tags">): boolean {
  return message.tags?.[E2EE_NOTICE_TAG] === "warning";
}
