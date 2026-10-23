import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaRegCopy, FaReply } from "react-icons/fa";
import { copyToClipboard } from "../../lib/clipboard";
import BottomSheet from "./BottomSheet";

interface MessageReaderSheetProps {
  isOpen: boolean;
  onClose: () => void;
  author?: string;
  time?: string;
  copyText?: string;
  onReply?: () => void;
  children: React.ReactNode;
}

// Shows a whole message on touch screens, so reading a long one leaves the chat still.
const MessageReaderSheet: React.FC<MessageReaderSheetProps> = ({
  isOpen,
  onClose,
  author,
  time,
  copyText,
  onReply,
  children,
}) => {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col max-h-[80vh]">
        {(author || time) && (
          <div className="flex items-baseline gap-2 px-4 pb-3">
            <span className="font-semibold text-white truncate">{author}</span>
            <span className="row-meta shrink-0">{time}</span>
          </div>
        )}
        <div className="hairline" />
        <div className="px-4 py-3 overflow-y-auto text-discord-text-normal whitespace-pre-wrap break-words">
          {children}
        </div>
        <div className="hairline" />
        <div className="flex gap-2 px-4 pt-3">
          {onReply && (
            <button
              type="button"
              className="sheet-action"
              onClick={() => {
                onClose();
                onReply();
              }}
            >
              <FaReply className="text-xs" />
              <Trans>Reply</Trans>
            </button>
          )}
          {copyText !== undefined && (
            <button
              type="button"
              className={`sheet-action ${hasCopyFailed ? "text-red-400" : ""}`}
              onClick={() =>
                copyToClipboard(copyText).then((isCopied) =>
                  isCopied ? onClose() : setHasCopyFailed(true),
                )
              }
            >
              <FaRegCopy className="text-xs" />
              {hasCopyFailed ? (
                <Trans>Copy failed, tap to retry</Trans>
              ) : (
                <Trans>Copy</Trans>
              )}
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};

export default MessageReaderSheet;
