import { useLingui } from "@lingui/react/macro";
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

const HEADER_ACTION =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-discord-dark-300 text-discord-text-normal active:bg-discord-dark-400";

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
  const { t } = useLingui();
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const copyLabel = hasCopyFailed ? t`Copy failed, tap to retry` : t`Copy`;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate font-semibold text-white">{author}</span>
            <span className="row-meta shrink-0">{time}</span>
          </div>
          {onReply && (
            <button
              type="button"
              className={HEADER_ACTION}
              aria-label={t`Reply`}
              title={t`Reply`}
              onClick={() => {
                onClose();
                onReply();
              }}
            >
              <FaReply className="text-sm" />
            </button>
          )}
          {copyText !== undefined && (
            <button
              type="button"
              className={`${HEADER_ACTION} ${hasCopyFailed ? "text-red-400" : ""}`}
              aria-label={copyLabel}
              title={copyLabel}
              onClick={() =>
                copyToClipboard(copyText).then((isCopied) =>
                  isCopied ? onClose() : setHasCopyFailed(true),
                )
              }
            >
              <FaRegCopy className="text-sm" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-4 pb-2 pt-1 text-[15px] leading-relaxed text-discord-text-normal whitespace-pre-wrap break-words">
          {children}
        </div>
      </div>
    </BottomSheet>
  );
};

export default MessageReaderSheet;
