import { useEffect, useState } from "react";
import type { CommandInvocation } from "../lib/commandInvocation";

const HISTORY_LIMIT = 100;

export type BotCommandRun = Pick<
  CommandInvocation,
  "botNick" | "command" | "values"
>;
export type SentInput = string | BotCommandRun;

// We skip lines that can carry a password, so arrow up never puts one back on screen.
const SECRET_INPUT =
  /^\/(?:oper|pass|password|identify|register|ghost|recover|regain|setpass|sendpass|resetpass|login|auth|sasl|quote|raw|ns|nickserv)\b|^\/msg\s+\S*serv\b/i;
const SERVICE_NICK = /serv$/i;

// We keep only what the user typed in this session, since a bot or another
// session could put text in the chat that recall would then send as ours.
const sentByBuffer = new Map<string, SentInput[]>();

export function recordSentInput(
  bufferKey: string,
  input: SentInput,
  privateChatNick?: string,
): void {
  if (!bufferKey) return;
  if (typeof input === "string") {
    const line = input.trim();
    if (line === "" || SECRET_INPUT.test(line)) return;
  }
  if (privateChatNick && SERVICE_NICK.test(privateChatNick)) return;
  const sent = sentByBuffer.get(bufferKey) ?? [];
  if (JSON.stringify(sent[0]) === JSON.stringify(input)) return;
  sentByBuffer.set(bufferKey, [input, ...sent].slice(0, HISTORY_LIMIT));
}

export function useMessageHistory(bufferKey: string) {
  const [messageHistoryIndex, setMessageHistoryIndex] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a buffer switch is the only trigger
  useEffect(() => {
    setMessageHistoryIndex(-1);
  }, [bufferKey]);

  const sentAt = (index: number): SentInput | null =>
    sentByBuffer.get(bufferKey)?.[index] ?? null;

  const navigateUp = (): SentInput | null => {
    const count = sentByBuffer.get(bufferKey)?.length ?? 0;
    if (count === 0) return null;
    const newIndex = Math.min(messageHistoryIndex + 1, count - 1);
    setMessageHistoryIndex(newIndex);
    return sentAt(newIndex);
  };

  // Recall starts only from an empty composer, so leaving history returns to an empty one.
  const navigateDown = (): SentInput | null => {
    if (messageHistoryIndex < 0) return null;
    const newIndex = messageHistoryIndex - 1;
    setMessageHistoryIndex(newIndex);
    return newIndex >= 0 ? sentAt(newIndex) : "";
  };

  const resetHistory = (): void => {
    if (messageHistoryIndex >= 0) setMessageHistoryIndex(-1);
  };

  return {
    messageHistoryIndex,
    navigateUp,
    navigateDown,
    resetHistory,
  };
}
