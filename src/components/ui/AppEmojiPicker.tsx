import EmojiPicker, {
  type EmojiClickData,
  EmojiStyle,
  Theme,
} from "emoji-picker-react";
import { useEffect, useRef } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { PickerCustomEmoji } from "../../lib/customEmojiPicker";

interface AppEmojiPickerProps {
  onEmojiClick: (emojiData: EmojiClickData) => void;
  reactedEmojis?: string[];
  // draft/custom-emoji: optional list of network/channel-scoped
  // emojis to surface in the picker as a separate category.  Click
  // result will have `isCustom: true` and `names[0]` set to the
  // shortcode -- callers should funnel through emojiClickValue().
  customEmojis?: PickerCustomEmoji[];
}

const toUnified = (emoji: string) =>
  [...emoji]
    .map((c) => c.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join("-");

/**
 * Shared emoji picker with app-wide defaults.
 * On mobile the search input is not auto-focused (prevents keyboard popup).
 */
export function AppEmojiPicker({
  onEmojiClick,
  reactedEmojis,
  customEmojis,
}: AppEmojiPickerProps) {
  const isMobile = useMediaQuery();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The library calls element.focus() via requestAnimationFrame internally,
  // which races with autoFocusSearch={false}. Blurring after a short delay
  // reliably prevents the on-screen keyboard from appearing on mobile.
  useEffect(() => {
    if (!isMobile) return;
    const id = setTimeout(() => {
      const input =
        wrapperRef.current?.querySelector<HTMLInputElement>("input");
      input?.blur();
    }, 50);
    return () => clearTimeout(id);
  }, [isMobile]);

  return (
    <div ref={wrapperRef} data-reaction-picker="">
      {reactedEmojis && reactedEmojis.length > 0 && (
        <style>
          {reactedEmojis
            .map(
              (e) =>
                `[data-reaction-picker] button.epr-emoji[data-unified="${toUnified(e)}"] { background: rgba(59,130,246,0.25) !important; border-radius: 6px !important; }`,
            )
            .join("\n")}
        </style>
      )}
      <EmojiPicker
        onEmojiClick={onEmojiClick}
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        width="100%"
        height={isMobile ? 500 : 400}
        searchPlaceholder="Search emojis..."
        previewConfig={{ showPreview: false }}
        skinTonesDisabled={false}
        lazyLoadEmojis={true}
        autoFocusSearch={!isMobile}
        customEmojis={customEmojis}
      />
    </div>
  );
}
