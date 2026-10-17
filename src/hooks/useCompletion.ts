import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useSuggestionKeys } from "./useSuggestionKeys";

export interface CompletionRange {
  query: string;
  start: number;
  end: number;
}

export interface CompletionProvider<T> {
  title: ReactNode;
  match(text: string, caret: number): CompletionRange | null;
  getItems(query: string): readonly T[];
  getKey(item: T): string;
  renderItem(item: T): ReactNode;
  // Returns the text that replaces the matched range, or nothing when the
  // provider handled the pick itself.
  // biome-ignore lint/suspicious/noConfusingVoidType: providers that act on a pick return nothing at all
  accept(item: T, range: CompletionRange, text: string): string | void;
  // Offers items only when the input asks through `cycle` (Tab), and writes
  // each candidate into the input as the highlight moves.
  manual?: boolean;
  // The first cycle step only fills the input, so Enter still sends; the list
  // appears from the second step on.
  quietFirstStep?: boolean;
  acceptKeys?: readonly string[];
  closeKeys?: readonly string[];
  cycleKeys?: readonly string[];
}

interface UseCompletionOptions<T> {
  providers: readonly CompletionProvider<T>[];
  text: string;
  caret: number;
  onReplace: (text: string, caret: number) => void;
  // Keys stay with the input while this is false; the items still show.
  keysActive?: boolean;
  acceptKeys?: readonly string[];
  onDismiss?: () => void;
}

export interface Completion<T = unknown> {
  provider: CompletionProvider<T> | null;
  items: readonly T[];
  isOpen: boolean;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  pick: (item: T) => void;
}

export interface CyclingCompletion<T> extends Completion<T> {
  // Starts a cycle through the manual providers, or steps the running one.
  // Returns whether anything was written into the input.
  cycle: (text: string, caret: number, step?: 1 | -1) => boolean;
  stopCycling: () => void;
}

interface Cycle<T> {
  provider: CompletionProvider<T>;
  range: CompletionRange;
  items: readonly T[];
  base: string;
  written: string;
  isListShown: boolean;
}

export function useCompletion<T = unknown>({
  providers,
  text,
  caret,
  onReplace,
  keysActive = true,
  acceptKeys,
  onDismiss,
}: UseCompletionOptions<T>): CyclingCompletion<T> {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle<T> | null>(null);
  // Any edit we did not write ourselves ends the cycle.
  const liveCycle = cycle?.written === text ? cycle : null;

  useEffect(() => {
    if (cycle && !liveCycle) setCycle(null);
  }, [cycle, liveCycle]);

  const typed = useMemo(() => {
    for (const provider of providers) {
      if (provider.manual) continue;
      const range = provider.match(text, caret);
      if (!range) continue;
      const items = provider.getItems(range.query);
      // A token that already names its only suggestion is complete.
      const isComplete =
        items.length === 1 &&
        provider.getKey(items[0]).toLowerCase() === range.query.toLowerCase();
      return isComplete ? null : { provider, range, items, base: text };
    }
    return null;
  }, [providers, text, caret]);

  const query = typed?.range.query;
  const typedCount = typed?.items.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: we restart at the top whenever the typed query or its results change
  useEffect(() => setSelectedIndex(0), [query, typedCount]);

  const current = liveCycle ?? typed;
  const items = current?.items ?? [];
  const isOpen =
    items.length > 0 &&
    (liveCycle ? liveCycle.isListShown : dismissedText !== text);

  const write = (
    { provider, range, base }: Pick<Cycle<T>, "provider" | "range" | "base">,
    item: T,
  ): string | undefined => {
    const replacement = provider.accept(item, range, base);
    if (typeof replacement !== "string") return undefined;
    const written =
      base.slice(0, range.start) + replacement + base.slice(range.end);
    onReplace(written, range.start + replacement.length);
    return written;
  };

  const pick = (item: T) => {
    if (!current) return;
    setCycle(null);
    write(current, item);
  };

  const stepTo = (running: Cycle<T>, index: number) => {
    setSelectedIndex(index);
    const written = write(running, running.items[index]);
    if (written !== undefined)
      setCycle({ ...running, written, isListShown: true });
  };

  const startCycle = (input: string, at: number, step: 1 | -1): boolean => {
    for (const provider of providers) {
      if (!provider.manual) continue;
      const range = provider.match(input, at);
      if (!range) continue;
      const found = provider.getItems(range.query);
      if (found.length === 0) return false;
      const index = step === 1 ? 0 : found.length - 1;
      const started = { provider, range, items: found, base: input };
      const written = write(started, found[index]);
      if (written === undefined) return false;
      setSelectedIndex(index);
      setCycle({
        ...started,
        written,
        isListShown: !provider.quietFirstStep,
      });
      return true;
    }
    return false;
  };

  const cycleFrom = (input: string, at: number, step: 1 | -1 = 1) => {
    if (cycle?.written !== input) return startCycle(input, at, step);
    const count = cycle.items.length;
    stepTo(cycle, (selectedIndex + step + count) % count);
    return true;
  };

  const stopCycling = () => {
    if (cycle) setCycle(null);
  };

  const provider = current?.provider;
  useSuggestionKeys({
    isActive: isOpen && keysActive,
    count: items.length,
    selectedIndex,
    onMove: (index) =>
      liveCycle ? stepTo(liveCycle, index) : setSelectedIndex(index),
    onAccept: (index) => {
      const item = items[index];
      if (item === undefined) return false;
      pick(item);
      return true;
    },
    onClose: () => {
      setCycle(null);
      if (onDismiss) onDismiss();
      else setDismissedText(text);
    },
    acceptKeys: provider?.acceptKeys ?? acceptKeys,
    closeKeys: provider?.closeKeys,
    cycleKeys: provider?.cycleKeys,
  });

  return {
    provider: provider ?? null,
    items,
    isOpen,
    selectedIndex,
    setSelectedIndex,
    pick,
    cycle: cycleFrom,
    stopCycling,
  };
}
