import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { FaCheck, FaRegCopy, FaTimes } from "react-icons/fa";
import { copyToClipboard } from "../../lib/clipboard";

interface CopyButtonProps {
  getText: () => string;
  label?: string;
  className?: string;
}

type CopyStatus = "idle" | "copied" | "failed";

const STATUS_MS = 1500;

export const CopyButton: React.FC<CopyButtonProps> = ({
  getText,
  label,
  className = "",
}) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const title =
    status === "copied"
      ? t`Copied`
      : status === "failed"
        ? t`Copy failed, select to retry`
        : (label ?? t`Copy`);
  const tone =
    status === "copied"
      ? "text-discord-green"
      : status === "failed"
        ? "text-red-400"
        : "";
  return (
    <button
      type="button"
      className={`icon-button ${tone} ${className}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(getText()).then((isCopied) =>
          setStatus(isCopied ? "copied" : "failed"),
        );
      }}
    >
      {status === "copied" ? (
        <FaCheck />
      ) : status === "failed" ? (
        <FaTimes />
      ) : (
        <FaRegCopy />
      )}
    </button>
  );
};

export default CopyButton;
