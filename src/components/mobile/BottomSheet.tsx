import type React from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // React bubbles portal events through the component tree, so we stop touches
  // here or the long-press and swipe handlers around the opener would fire too.
  const stopTouch = (e: React.TouchEvent) => e.stopPropagation();

  return createPortal(
    <div
      className="fixed inset-0 z-[9998]"
      data-no-gesture=""
      onTouchStart={stopTouch}
      onTouchMove={stopTouch}
      onTouchEnd={stopTouch}
    >
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute bottom-0 left-0 right-0 surface-sheet"
        style={{ animation: "bottom-sheet-slide-up 200ms ease-out" }}
      >
        <span className="sheet-handle mb-2" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
