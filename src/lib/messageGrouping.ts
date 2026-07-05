import type { Message } from "../types";
import { isUnprotectedMessage } from "./e2ee/messageFlags";

// Consecutive messages from the same author within this window collapse under a
// single header/avatar.
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Whether a message starts a new visual group (avatar + name shown). Beyond the
// usual author and time-gap breaks, a change in encryption protection also
// breaks the group so an unencrypted run is always its own distinct block rather
// than blending into an encrypted one.
export function shouldShowMessageHeader(
  previous: Message | undefined,
  message: Message,
): boolean {
  return (
    !previous ||
    previous.type !== "message" ||
    previous.userId !== message.userId ||
    isUnprotectedMessage(previous) !== isUnprotectedMessage(message) ||
    new Date(message.timestamp).getTime() -
      new Date(previous.timestamp).getTime() >
      GROUP_WINDOW_MS
  );
}
