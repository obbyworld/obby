import type { Message } from "../types";
import { isUnprotectedMessage } from "./e2ee/messageFlags";

// Consecutive messages from the same author within this window collapse under a
// single header/avatar.
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** A private message shown inside a channel (the channel-context tag). */
export function isWhisper(message: Message): boolean {
  const tags = message.tags;
  return !!(
    tags?.["+channel-context"] ||
    tags?.["channel-context"] ||
    tags?.["+draft/channel-context"] ||
    tags?.["draft/channel-context"]
  );
}

// Whether a message starts a new visual group (avatar + name shown). Beyond the
// usual author and time-gap breaks, a change in encryption protection also
// breaks the group so an unencrypted run is always its own distinct block.
// Every whisper sits in its own bubble, so each one shows its sender.
export function shouldShowMessageHeader(
  previous: Message | undefined,
  message: Message,
): boolean {
  return (
    isWhisper(message) ||
    previous?.type !== "message" ||
    previous.userId !== message.userId ||
    isUnprotectedMessage(previous) !== isUnprotectedMessage(message) ||
    new Date(message.timestamp).getTime() -
      new Date(previous.timestamp).getTime() >
      GROUP_WINDOW_MS
  );
}
