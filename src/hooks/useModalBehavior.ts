import { useEffect, useRef } from "react";

export interface UseModalBehaviorOptions {
  onClose: () => void;
  isOpen: boolean;
  escapeKeyEnabled?: boolean;
  clickOutsideEnabled?: boolean;
}

export const useModalBehavior = ({
  onClose,
  isOpen,
  escapeKeyEnabled = true,
  clickOutsideEnabled = true,
}: UseModalBehaviorOptions) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !escapeKeyEnabled) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, escapeKeyEnabled]);

  const getBackdropProps = () => ({
    role: "dialog" as const,
    "aria-modal": true,
    onClick: clickOutsideEnabled ? onClose : undefined,
  });

  const getContentProps = () => ({
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });

  return {
    getBackdropProps,
    getContentProps,
  };
};
