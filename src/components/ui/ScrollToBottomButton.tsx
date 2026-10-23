import { t } from "@lingui/core/macro";
import type React from "react";
import { FaArrowDown } from "react-icons/fa";

interface ScrollToBottomButtonProps {
  isVisible: boolean;
  onClick: () => void;
  unreadCount?: number;
}

export const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  isVisible,
  onClick,
  unreadCount,
}) => {
  if (!isVisible) return null;

  return (
    <div className="relative bottom-10 z-50">
      <div className="absolute right-4">
        <button
          onClick={onClick}
          // Prevent focus leaving the textarea (which hides the keyboard on mobile)
          // while still letting the click fire and scroll to bottom.
          onMouseDown={(e) => e.preventDefault()}
          className="scroll-to-bottom-btn p-3 bg-discord-dark-300 hover:bg-discord-dark-200 text-discord-text-muted hover:text-discord-channels-default rounded-full shadow-2xl transition-colors relative"
          aria-label={t`Scroll to bottom`}
        >
          <FaArrowDown className="w-4 h-4" />
          {unreadCount && unreadCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-discord-primary text-white text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
