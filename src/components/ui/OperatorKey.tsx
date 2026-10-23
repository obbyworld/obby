import { t } from "@lingui/core/macro";
import type React from "react";
import { FaKey } from "react-icons/fa";

export const OperatorKey: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <span
    className={`shrink-0 inline-flex text-amber-400 text-[10px] ${className}`}
    title={t`IRC Operator`}
    role="img"
    aria-label={t`IRC Operator`}
  >
    <FaKey />
  </span>
);

export default OperatorKey;
