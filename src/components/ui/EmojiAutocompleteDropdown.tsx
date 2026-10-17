import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import SuggestionList from "./SuggestionList";

interface EmojiItem {
  unified: string;
  short_names: string[];
  category: string;
  emoji: string;
  // draft/custom-emoji: when set, the dropdown row shows the image
  // instead of the unicode glyph and the inserted text is `:shortcode:`
  // (already encoded into `emoji` by the completion hook).
  imageUrl?: string;
  isCustom?: boolean;
}

interface EmojiAutocompleteDropdownProps {
  isVisible: boolean;
  inputValue: string;
  cursorPosition: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null;
  emojiMatches?: EmojiItem[];
  currentMatchIndex?: number;
  onNavigate?: (emoji: string) => void;
}

const MAX_EMOJIS = 10;
const CLOSE_KEYS = ["Escape", " "];

export const EmojiAutocompleteDropdown: React.FC<
  EmojiAutocompleteDropdownProps
> = ({
  isVisible,
  onSelect,
  onClose,
  inputElement,
  emojiMatches = [],
  currentMatchIndex = 0,
  onNavigate,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const displayEmojis = emojiMatches.slice(0, MAX_EMOJIS);

  useEffect(() => {
    setSelectedIndex(emojiMatches.length > 0 ? currentMatchIndex : 0);
  }, [currentMatchIndex, emojiMatches.length]);

  useSuggestionKeys({
    isActive: isVisible,
    count: displayEmojis.length,
    selectedIndex,
    onMove: (index) => {
      setSelectedIndex(index);
      const item = displayEmojis[index];
      if (item) onNavigate?.(item.emoji);
    },
    onAccept: (index) => {
      const item = displayEmojis[index];
      if (item) onSelect(item.emoji);
      return true;
    },
    onClose,
    closeKeys: CLOSE_KEYS,
  });

  if (!isVisible || displayEmojis.length === 0) return null;

  return (
    <SuggestionList
      title={<Trans>Emojis</Trans>}
      items={displayEmojis}
      getKey={(item) => item.unified}
      selectedIndex={selectedIndex}
      onHover={setSelectedIndex}
      onPick={(item) => onSelect(item.emoji)}
      anchor={inputElement}
      renderItem={(item) => (
        <>
          <span className="w-6 h-6 shrink-0 flex items-center justify-center text-xl">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={`:${item.short_names[0]}:`}
                className="max-w-full max-h-full object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : (
              item.emoji
            )}
          </span>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="truncate">:{item.short_names[0]}:</span>
            {item.short_names.length > 1 && (
              <span className="row-meta truncate">
                :{item.short_names.slice(1, 3).join(": :")}:
              </span>
            )}
          </span>
          <span className="row-meta shrink-0 capitalize">{item.category}</span>
        </>
      )}
    />
  );
};

export default EmojiAutocompleteDropdown;
