import useStore from "../store";
import {
  hasSavedChat,
  showPresent,
  showSavedMessagesAround,
} from "../store/handlers/history";
import type { Message } from "../types";
import { plainText } from "./history/searchFields";
import ircClient from "./ircClient";
import { isChannelTarget } from "./ircUtils";

export interface MessageLocation {
  serverId: string;
  target: string;
  time: number;
  msgid?: string;
  nick?: string;
  text?: string;
}

// left-channel: the hit is in a channel we are no longer in.
// not-saved: the message is neither loaded nor saved on this device.
// not-found: the chat is open but the message is gone.
export type JumpFailure = "left-channel" | "not-saved" | "not-found";

export type JumpResult =
  | { ok: true; messageId?: string }
  | { ok: false; reason: JumpFailure };

// Replay rewrites our own lines to our current nick, so a saved own line
// can carry either that or the nick we had when we sent it.
function findIn(
  messages: Message[],
  location: MessageLocation,
): Message | undefined {
  const { msgid, nick, text, time } = location;
  const byMsgid = msgid
    ? messages.find(
        (m) => m.msgid === msgid || m.multilineMessageIds?.includes(msgid),
      )
    : undefined;
  if (byMsgid) return byMsgid;
  const senders = [nick, ircClient.getNick(location.serverId)].map((n) =>
    n?.toLowerCase(),
  );
  return messages.find(
    (m) =>
      new Date(m.timestamp).getTime() === time &&
      (!nick || senders.includes(m.userId.toLowerCase())) &&
      (text === undefined || plainText(m.content) === text),
  );
}

const fail = (reason: JumpFailure): JumpResult => ({ ok: false, reason });

function hasChat(serverId: string, target: string): boolean {
  const server = useStore.getState().servers.find((s) => s.id === serverId);
  const lower = target.toLowerCase();
  return (
    !!server?.channels.some((c) => c.name.toLowerCase() === lower) ||
    !!server?.privateChats?.some((pc) => pc.username.toLowerCase() === lower)
  );
}

// Saved targets are lowercase, so we name a new private chat after the hit's
// sender when that is the peer.
async function selectChat(
  location: MessageLocation,
): Promise<{ id: string } | JumpFailure> {
  const { serverId, target, nick } = location;
  if (!useStore.getState().servers.some((s) => s.id === serverId))
    return "not-found";
  if (!hasChat(serverId, target)) {
    if (isChannelTarget(target)) return "left-channel";
    if (!(await hasSavedChat(useStore, serverId, target))) return "not-saved";
  }
  const peer = nick?.toLowerCase() === target.toLowerCase() ? nick : target;
  const id = useStore.getState().openChat(serverId, peer);
  return id ? { id } : "not-found";
}

const shownMessages = (key: string) => useStore.getState().messages[key] ?? [];

let latestJump = 0;

export async function jumpToMessage(
  location: MessageLocation,
): Promise<JumpResult> {
  const jump = ++latestJump;
  const chat = await selectChat(location);
  if (typeof chat === "string") return fail(chat);
  const { serverId, target, time } = location;
  const key = `${serverId}-${chat.id}`;
  const present = useStore.getState().historyWindows[key]?.present ?? [];
  if (!findIn(shownMessages(key), location) && findIn(present, location))
    showPresent(useStore, serverId, target);
  if (!findIn(shownMessages(key), location)) {
    const shown = await showSavedMessagesAround(
      useStore,
      serverId,
      target,
      time,
      () => jump === latestJump,
    );
    // A newer jump owns the screen and reports its own result.
    if (jump !== latestJump) return { ok: true };
    if (shown !== "loaded") return fail(shown);
  }
  const message = findIn(shownMessages(key), location);
  if (!message) return fail("not-found");
  useStore.getState().revealMessage(message.id);
  return { ok: true, messageId: message.id };
}

export const JUMP_FAILURE_COMMAND = "SEARCH_JUMP";

// A toast reports the reason as its code, so it can translate the text.
export function reportJumpFailure(serverId: string, reason: JumpFailure) {
  useStore.getState().addGlobalNotification({
    type: "note",
    command: JUMP_FAILURE_COMMAND,
    code: reason,
    message: reason,
    serverId,
  });
}
