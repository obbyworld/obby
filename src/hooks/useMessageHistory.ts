import { useEffect, useState } from "react";

const HISTORY_LIMIT = 100;

// We skip lines that can carry a password, so arrow up never puts one back on screen.
const SECRET_INPUT =
  /^\/(?:oper|pass|password|identify|register|ghost|recover|regain|setpass|sendpass|resetpass|login|auth|sasl|quote|raw|ns|nickserv)\b|^\/msg\s+\S*serv\b/i;

// We keep only what the user typed in this session, since a bot or another
// session could put text in the chat that recall would then send as ours.
const sentByBuffer = new Map<string, string[]>();

export function recordSentInput(bufferKey: string, text: string): void {
  const line = text.trim();
  if (!bufferKey || line === "" || SECRET_INPUT.test(line)) return;
  const sent = sentByBuffer.get(bufferKey) ?? [];
  if (sent[0] === text) return;
  sentByBuffer.set(bufferKey, [text, ...sent].slice(0, HISTORY_LIMIT));
}

export function useMessageHistory(bufferKey: string) {
  const [messageHistoryIndex, setMessageHistoryIndex] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a buffer switch is the only trigger
  useEffect(() => {
    setMessageHistoryIndex(-1);
  }, [bufferKey]);

  const sentAt = (index: number): string | null =>
    sentByBuffer.get(bufferKey)?.[index] ?? null;

  const navigateUp = (): string | null => {
    const count = sentByBuffer.get(bufferKey)?.length ?? 0;
    if (count === 0) return null;
    const newIndex = Math.min(messageHistoryIndex + 1, count - 1);
    setMessageHistoryIndex(newIndex);
    return sentAt(newIndex);
  };

  // Recall starts only from an empty composer, so leaving history returns to an empty one.
  const navigateDown = (): string | null => {
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
