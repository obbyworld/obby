import { XMarkIcon } from "@heroicons/react/24/solid";
import { t } from "@lingui/core/macro";
import type React from "react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { findTextField } from "../focus";

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  showCloseButton?: boolean;
  closeOnClickOutside?: boolean;
  closeOnEsc?: boolean;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  animate?: boolean;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  closeOnClickOutside = true,
  closeOnEsc = true,
  className = "",
  overlayClassName = "",
  contentClassName = "",
  maxWidth = "lg",
  animate = true,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose, closeOnEsc]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => {
        const modal = modalRef.current;
        if (!modal || modal.contains(document.activeElement)) return;
        (findTextField(modal) ?? modal).focus();
      }, 50);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Handle mouse down outside (desktop only)
  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnClickOutside && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnClickOutside, onClose],
  );

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-md",
    lg: "sm:max-w-lg",
    xl: "sm:max-w-xl",
    "2xl": "sm:max-w-2xl",
    full: "sm:max-w-full",
  };

  const header = (title || showCloseButton) && (
    <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
      {title && (
        <h2 id="modal-title" className="text-lg font-semibold text-white">
          {title}
        </h2>
      )}
      {showCloseButton && (
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-discord-dark-400 transition-colors text-discord-text-muted hover:text-white"
          aria-label={t`Close modal`}
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );

  const portalTarget = document.getElementById("root") || document.body;

  if (isMobile) {
    // Mobile: full-page view
    const mobileContent = (
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`fixed inset-0 z-[9999] bg-discord-dark-200 flex flex-col focus:outline-none overflow-x-hidden ${
          animate ? "animate-in fade-in" : ""
        } ${className} ${contentClassName}`}
        style={{
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
      >
        {header}
        <div className="modal-body overflow-y-auto overflow-x-hidden flex-1 flex flex-col">
          {children}
        </div>
      </div>
    );

    return createPortal(mobileContent, portalTarget);
  }

  // Desktop: original centered floating card
  const desktopContent = (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto p-4 ${
        animate ? "animate-in fade-in" : ""
      } ${overlayClassName}`}
      onMouseDown={handleOverlayMouseDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal Content */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`relative w-full my-auto focus:outline-none ${maxWidthClasses[maxWidth]} ${
          animate ? "animate-in zoom-in-95 slide-in-from-bottom-2" : ""
        } ${className}`}
      >
        <div
          className={`bg-discord-dark-200 rounded-lg shadow-xl max-h-[calc(100vh-2rem)] flex flex-col ${contentClassName}`}
        >
          {header}
          <div className="modal-body overflow-y-auto flex-1 flex flex-col">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(desktopContent, portalTarget);
};

export default BaseModal;
