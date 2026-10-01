import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { FaCheck, FaRegCopy } from "react-icons/fa";

interface CopyButtonProps {
  getText: () => string;
  label?: string;
  className?: string;
}

const COPIED_MS = 1500;

export const CopyButton: React.FC<CopyButtonProps> = ({
  getText,
  label,
  className = "",
}) => {
  const { t } = useLingui();
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const title = isCopied ? t`Copied` : (label ?? t`Copy`);
  return (
    <button
      type="button"
      className={`icon-button ${isCopied ? "text-discord-green" : ""} ${className}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(getText()).then(() => setIsCopied(true));
      }}
    >
      {isCopied ? <FaCheck /> : <FaRegCopy />}
    </button>
  );
};

export default CopyButton;
