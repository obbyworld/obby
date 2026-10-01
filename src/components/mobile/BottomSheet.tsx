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

  return createPortal(
    <div className="fixed inset-0 z-[9998]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 surface-sheet"
        style={{
          animation: "bottom-sheet-slide-up 200ms ease-out",
          paddingBottom: "calc(0.5rem + var(--safe-area-inset-bottom, 0px))",
        }}
      >
        <span className="sheet-handle mb-2" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
