import { t } from "@lingui/core/macro";
import type { EmojiClickData } from "emoji-picker-react";
import type { PickerCustomEmoji } from "../../lib/customEmojiPicker";
import { BaseModal } from "../../lib/modal/BaseModal";
import { AppEmojiPicker } from "./AppEmojiPicker";

interface EmojiPickerModalProps {
  isOpen: boolean;
  onEmojiClick: (emojiData: EmojiClickData) => void;
  onClose: () => void;
  customEmojis?: PickerCustomEmoji[];
}

export function EmojiPickerModal({
  isOpen,
  onEmojiClick,
  onClose,
  customEmojis,
}: EmojiPickerModalProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="sm"
      title={t`Pick an emoji`}
    >
      <div className="p-2">
        <AppEmojiPicker
          onEmojiClick={onEmojiClick}
          customEmojis={customEmojis}
        />
      </div>
    </BaseModal>
  );
}
