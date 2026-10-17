import type { ReactNode } from "react";

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  className = "",
}) => (
  <div
    className={`modal-footer flex items-center justify-end gap-2 px-5 pb-5 pt-1 ${className}`}
  >
    {children}
  </div>
);
