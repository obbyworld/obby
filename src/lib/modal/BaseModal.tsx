import { XMarkIcon } from "@heroicons/react/24/solid";
import { t } from "@lingui/core/macro";
import type React from "react";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { findTextField } from "../focus";
import { stopTouchOutsideMap } from "../leafletMap";

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

const maxWidthClasses = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  full: "sm:max-w-full",
};

// One dialog for every platform: a centered card for a mouse and a bottom
// sheet on touch, so each dialog is written once.
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
  const isTouch = useIsTouchInput();
  const titleId = useId();

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

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      // A touch keyboard opening on its own would cover the sheet, so we only
      // move focus into a text field for a mouse and keyboard.
      if (isTouch) return;
      setTimeout(() => {
        const modal = modalRef.current;
        if (!modal || modal.contains(document.activeElement)) return;
        (findTextField(modal) ?? modal).focus();
      }, 50);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen, isTouch]);

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnClickOutside && e.target === e.currentTarget) onClose();
    },
    [closeOnClickOutside, onClose],
  );

  if (!isOpen) return null;

  const header = (title || showCloseButton) && (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1 flex-shrink-0">
      {title && (
        <h2
          id={titleId}
          className="text-base font-semibold text-white min-w-0 truncate"
        >
          {title}
        </h2>
      )}
      {showCloseButton && (
        <button
          type="button"
          onClick={onClose}
          className={`icon-button ml-auto rounded-lg ${isTouch ? "w-10 h-10" : "w-8 h-8"}`}
          aria-label={t`Close`}
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );

  const portalTarget = document.getElementById("root") || document.body;

  if (isTouch) {
    // React bubbles portal events through the component tree, so we stop
    // touches here or the gesture handlers around the opener would fire too.
    return createPortal(
      <div
        className={`fixed inset-0 z-[9999] ${overlayClassName}`}
        data-no-gesture=""
        onTouchStart={stopTouchOutsideMap}
        onTouchMove={stopTouchOutsideMap}
        onTouchEnd={stopTouchOutsideMap}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 scrim animate-in fade-in duration-150"
          onClick={closeOnClickOutside ? onClose : undefined}
        />
        <div
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          className={`modal-sheet absolute inset-x-0 surface-sheet focus:outline-none ${className} ${contentClassName}`}
          style={{
            bottom: "var(--keyboard-height, 0px)",
            maxHeight:
              "calc(100% - var(--keyboard-height, 0px) - var(--safe-area-inset-top, 0px) - 1rem)",
            animation: animate
              ? "bottom-sheet-slide-up 200ms ease-out"
              : undefined,
          }}
        >
          <span className="sheet-handle" aria-hidden />
          {header}
          <div className="modal-body overflow-y-auto overscroll-contain min-h-0">
            {children}
          </div>
        </div>
      </div>,
      portalTarget,
    );
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto p-4 ${
        animate ? "animate-in fade-in duration-150" : ""
      } ${overlayClassName}`}
      onMouseDown={handleOverlayMouseDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="absolute inset-0 scrim" aria-hidden="true" />
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`relative w-full my-auto focus:outline-none ${maxWidthClasses[maxWidth]} ${
          animate ? "animate-in zoom-in-95 duration-150" : ""
        } ${className}`}
      >
        <div
          className={`surface-dialog max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden ${contentClassName}`}
        >
          {header}
          <div className="modal-body overflow-y-auto overscroll-contain min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
};

export default BaseModal;
