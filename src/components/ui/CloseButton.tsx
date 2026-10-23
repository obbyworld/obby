import type React from "react";
import { FaTimes } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { keepInputFocus } from "../../lib/focus";

export const CloseButton: React.FC<{ label: string; onClick: () => void }> = ({
  label,
  onClick,
}) => {
  const isTouch = useIsTouchInput();
  return (
    <button
      type="button"
      className={`mr-1 flex flex-shrink-0 items-center justify-center self-center rounded-lg text-discord-text-muted transition-colors hover:bg-white/10 hover:text-discord-text-normal ${isTouch ? "h-11 w-11" : "p-3"}`}
      onMouseDown={keepInputFocus}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      <FaTimes className="text-base" />
    </button>
  );
};
