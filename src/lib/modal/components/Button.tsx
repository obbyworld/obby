import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "success";

interface ButtonProps {
  variant?: ButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
}

const variantStyles = {
  primary: "bg-discord-primary hover:bg-discord-primary/85 text-white",
  secondary:
    "bg-discord-button-secondary-default hover:bg-discord-button-secondary-default/80 text-white",
  danger: "bg-discord-red hover:bg-discord-red/85 text-white",
  success: "bg-discord-green hover:bg-discord-green/85 text-white",
};

export const buttonClassName = (variant: ButtonVariant = "primary") =>
  `inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-primary/60 disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]}`;

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  children,
  onClick,
  disabled = false,
  className = "",
  type = "button",
  "aria-label": ariaLabel,
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={`${buttonClassName(variant)} ${className}`}
  >
    {children}
  </button>
);
