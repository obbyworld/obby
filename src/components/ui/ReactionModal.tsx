import { t } from "@lingui/core/macro";
import type { EmojiClickData } from "emoji-picker-react";
import type React from "react";
import { BaseModal } from "../../lib/modal/BaseModal";
import { AppEmojiPicker } from "./AppEmojiPicker";

interface ReactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  reactedEmojis?: string[];
}

const ReactionModal: React.FC<ReactionModalProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  reactedEmojis,
}) => {
  const handleEmojiSelect = (emojiData: EmojiClickData) => {
    onSelectEmoji(emojiData.emoji);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="sm"
      title={t`Add a reaction`}
    >
      <div className="p-2">
        <AppEmojiPicker
          onEmojiClick={handleEmojiSelect}
          reactedEmojis={reactedEmojis}
        />
      </div>
    </BaseModal>
  );
};

export default ReactionModal;
