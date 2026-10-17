import type React from "react";

export type DockButtonState = "neutral" | "off" | "active" | "danger";
export type DockButtonSize = "sm" | "md";

interface DockButtonProps {
  icon: React.ReactNode;
  state?: DockButtonState;
  size?: DockButtonSize;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

const STATE_CLASSES: Record<DockButtonState, string> = {
  neutral: "bg-discord-dark-200 hover:bg-discord-dark-500 text-white",
  off: "bg-white text-discord-dark-400 hover:bg-white/90",
  active: "bg-discord-green text-white hover:opacity-90",
  danger: "bg-discord-red text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<DockButtonSize, string> = {
  sm: "w-11 h-11 text-base",
  md: "w-12 h-12 text-xl",
};

/** The only button style used by the dock and the pop-out card. */
export const DockButton: React.FC<DockButtonProps> = ({
  icon,
  state = "neutral",
  size = "md",
  label,
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${STATE_CLASSES[state]} ${SIZE_CLASSES[size]}`}
  >
    {icon}
  </button>
);

export default DockButton;
