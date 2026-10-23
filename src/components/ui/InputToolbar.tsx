import { t } from "@lingui/core/macro";
import { FaArrowUp, FaAt, FaGrinAlt } from "react-icons/fa";

interface InputToolbarProps {
  selectedColor: string | null;
  onEmojiClick: () => void;
  onColorPickerClick: () => void;
  onAtClick: () => void;
  onSendClick?: () => void;
  showSendButton?: boolean;
  hideEmoji?: boolean;
  hideFormatting?: boolean;
  canSend?: boolean;
}

/**
 * Displays formatting toolbar buttons (emoji, color, mentions)
 */
export function InputToolbar({
  selectedColor,
  onEmojiClick,
  onColorPickerClick,
  onAtClick,
  onSendClick,
  showSendButton = false,
  hideEmoji = false,
  hideFormatting = false,
  canSend = false,
}: InputToolbarProps) {
  return (
    <div className="flex shrink-0 items-center">
      {!hideEmoji && !hideFormatting && (
        <button
          aria-label={t`Insert emoji`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center text-discord-text-muted hover:text-discord-text-normal"
          onClick={onEmojiClick}
        >
          <FaGrinAlt />
        </button>
      )}
      {!hideFormatting && (
        <button
          aria-label={t`Format text`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center text-discord-text-muted hover:text-discord-text-normal"
          onClick={onColorPickerClick}
        >
          <div
            className="w-4 h-4 rounded-full border-2 border-white-700"
            style={{
              backgroundColor:
                selectedColor === "inherit"
                  ? "transparent"
                  : (selectedColor ?? undefined),
            }}
          />
        </button>
      )}
      {!hideFormatting && (
        <button
          aria-label={t`Mention someone`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center text-discord-text-muted hover:text-discord-text-normal"
          onClick={onAtClick}
        >
          <FaAt />
        </button>
      )}
      {showSendButton && (
        <button
          aria-label={t`Send message`}
          className={`ml-1 w-9 h-9 rounded-full text-white flex items-center justify-center shrink-0
            transition-[transform,opacity,box-shadow] duration-200 ease-out active:scale-90 ${
              canSend
                ? "bg-discord-primary shadow-lg shadow-discord-primary/40 scale-100 opacity-100"
                : "bg-discord-primary/40 scale-90 opacity-60"
            }`}
          onClick={onSendClick}
          disabled={!canSend}
          // Prevent the button from stealing focus from the textarea on iOS —
          // without this the keyboard hides every time the send button is tapped.
          onMouseDown={(e) => e.preventDefault()}
        >
          <FaArrowUp size={14} />
        </button>
      )}
    </div>
  );
}
