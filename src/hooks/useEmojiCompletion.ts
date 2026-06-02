import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedShortcode } from "../lib/customEmoji";

interface EmojiItem {
  unified: string;
  short_names: string[];
  category: string;
  // For Unicode emoji this is the literal character; for custom
  // (draft/custom-emoji) entries it's `:shortcode:` so the renderer
  // downstream resolves it via the trusted pack image URL.
  emoji: string;
  // draft/custom-emoji: present for entries sourced from a network
  // or channel pack.  Drives the dropdown row preview.
  imageUrl?: string;
  isCustom?: boolean;
}

interface RawEmojiData {
  unified: string;
  short_names: string[];
  category: string;
}

interface EmojiCompletionState {
  isActive: boolean;
  matches: EmojiItem[];
  currentIndex: number;
  originalText: string;
  completionStart: number;
  originalPrefix: string;
}

interface EmojiCompletionResult {
  isActive: boolean;
  matches: EmojiItem[];
  currentIndex: number;
  originalText: string;
  completionStart: number;
  originalPrefix: string;
  handleEmojiCompletion: (
    currentText: string,
    cursorPosition: number,
  ) => {
    newText: string;
    newCursorPosition: number;
  } | null;
  resetCompletion: () => void;
  setCurrentIndex: (index: number) => void;
  updatePreviousText: (text: string) => void;
}

function processEmojiData(raw: RawEmojiData[]): EmojiItem[] {
  return raw.map((emoji) => ({
    unified: emoji.unified,
    short_names: emoji.short_names,
    category: emoji.category,
    emoji: String.fromCodePoint(
      ...emoji.unified.split("-").map((hex) => Number.parseInt(hex, 16)),
    ),
  }));
}

export function useEmojiCompletion(
  customShortcodes: ResolvedShortcode[] = [],
): EmojiCompletionResult {
  // Mix custom (draft/custom-emoji) shortcodes into the searchable
  // pool.  Custom entries always win over Unicode entries with the
  // same name -- network packs typically intend to override.
  const customEmojiData = useMemo<EmojiItem[]>(
    () =>
      customShortcodes.map((sc) => ({
        unified: `custom-${sc.packId}-${sc.shortcode}`,
        short_names: [sc.shortcode],
        category: "Custom",
        emoji: `:${sc.shortcode}:`,
        imageUrl: sc.url,
        isCustom: true,
      })),
    [customShortcodes],
  );
  const [unicodeEmoji, setUnicodeEmoji] = useState<EmojiItem[]>([]);
  useEffect(() => {
    let active = true;
    import("virtual:emoji-slim")
      .then((m) => {
        if (active)
          setUnicodeEmoji(processEmojiData(m.default as RawEmojiData[]));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const allEmojiData = useMemo<EmojiItem[]>(() => {
    const customNames = new Set(
      customEmojiData.flatMap((e) => e.short_names.map((n) => n.toLowerCase())),
    );
    const filteredUnicode = unicodeEmoji.filter(
      (u) => !u.short_names.some((n) => customNames.has(n.toLowerCase())),
    );
    return [...customEmojiData, ...filteredUnicode];
  }, [customEmojiData, unicodeEmoji]);

  const [state, setState] = useState<EmojiCompletionState>({
    isActive: false,
    matches: [],
    currentIndex: 0,
    originalText: "",
    completionStart: 0,
    originalPrefix: "",
  });

  const previousTextRef = useRef<string>("");

  const resetCompletion = useCallback(() => {
    setState({
      isActive: false,
      matches: [],
      currentIndex: 0,
      originalText: "",
      completionStart: 0,
      originalPrefix: "",
    });
  }, []);

  const setCurrentIndex = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      currentIndex: index,
    }));
  }, []);

  const updatePreviousText = useCallback((text: string) => {
    previousTextRef.current = text;
  }, []);

  const handleEmojiCompletion = useCallback(
    (
      currentText: string,
      cursorPosition: number,
    ): { newText: string; newCursorPosition: number } | null => {
      // Check if text was manually modified during active completion
      if (previousTextRef.current !== currentText && state.isActive) {
        const expectedText =
          state.originalText.substring(0, state.completionStart) +
          state.matches[state.currentIndex].emoji +
          state.originalText.substring(
            state.completionStart + state.originalPrefix.length,
          );

        if (currentText !== expectedText) {
          resetCompletion();
          return null;
        }
      }

      if (!state.isActive) {
        // Only activate on first tab when we find a `:word` pattern
        const textBeforeCursor = currentText.substring(0, cursorPosition);
        const emojiMatch = textBeforeCursor.match(/:([a-zA-Z_]+)$/);

        if (!emojiMatch) {
          return null;
        }

        const [fullMatch, emojiQuery] = emojiMatch;
        const completionStart = cursorPosition - fullMatch.length;

        if (emojiQuery.length === 0) {
          return null;
        }

        // Find matching emojis
        const matches = allEmojiData
          .filter((emoji) =>
            emoji.short_names.some((name) =>
              name.toLowerCase().includes(emojiQuery.toLowerCase()),
            ),
          )
          .slice(0, 10); // Limit to 10 matches

        if (matches.length === 0) {
          return null;
        }

        const selectedEmoji = matches[0].emoji;

        const newText =
          currentText.substring(0, completionStart) +
          selectedEmoji +
          currentText.substring(cursorPosition);

        const newCursorPosition = completionStart + selectedEmoji.length;

        setState({
          isActive: true,
          matches,
          currentIndex: 0,
          originalText: currentText,
          completionStart,
          originalPrefix: fullMatch,
        });

        previousTextRef.current = newText;
        return { newText, newCursorPosition };
      }

      // Already active - cycle through matches on subsequent tabs
      const nextIndex = (state.currentIndex + 1) % state.matches.length;
      const selectedEmoji = state.matches[nextIndex].emoji;

      const newText =
        state.originalText.substring(0, state.completionStart) +
        selectedEmoji +
        state.originalText.substring(
          state.completionStart + state.originalPrefix.length,
        );

      const newCursorPosition = state.completionStart + selectedEmoji.length;

      setState((prev) => ({
        ...prev,
        currentIndex: nextIndex,
      }));

      previousTextRef.current = newText;
      return { newText, newCursorPosition };
    },
    [state, resetCompletion, allEmojiData],
  );

  return {
    isActive: state.isActive,
    matches: state.matches,
    currentIndex: state.currentIndex,
    originalText: state.originalText,
    completionStart: state.completionStart,
    originalPrefix: state.originalPrefix,
    handleEmojiCompletion,
    resetCompletion,
    setCurrentIndex,
    updatePreviousText,
  };
}
