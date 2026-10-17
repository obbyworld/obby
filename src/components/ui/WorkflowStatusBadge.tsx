import { useLingui } from "@lingui/react/macro";
import type React from "react";
import {
  FaCheck,
  FaExclamation,
  FaSpinner,
  FaStop,
  FaTimes,
  FaTimesCircle,
} from "react-icons/fa";
import type { AiStep, AiWorkflow } from "../../store";

interface WorkflowStatusBadgeProps {
  state: AiWorkflow["state"];
  isTimedOut?: boolean;
  className?: string;
}

type BadgeTone = "complete" | "failed" | "cancelled" | "running";

const BADGE_TONES: Record<BadgeTone, { tone: string; icon: React.ReactNode }> =
  {
    complete: {
      tone: "bg-discord-green/15 text-discord-green",
      icon: <FaCheck />,
    },
    failed: { tone: "bg-red-500/15 text-red-400", icon: <FaTimes /> },
    cancelled: {
      tone: "bg-discord-dark-500/40 text-discord-text-muted",
      icon: <FaStop className="scale-75" />,
    },
    running: {
      tone: "bg-blue-500/15 text-blue-400",
      icon: <FaSpinner className="animate-spin" />,
    },
  };

const toneOf = (state: AiWorkflow["state"]): BadgeTone =>
  state === "complete" || state === "failed" || state === "cancelled"
    ? state
    : "running";

export const WorkflowStatusBadge: React.FC<WorkflowStatusBadgeProps> = ({
  state,
  isTimedOut = false,
  className = "",
}) => {
  const { t } = useLingui();
  const tone = toneOf(state);
  const label = isTimedOut
    ? t`timed out`
    : {
        complete: t`complete`,
        failed: t`failed`,
        cancelled: t`cancelled`,
        running: t`running`,
      }[tone];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`status-badge ${BADGE_TONES[tone].tone} ${className}`}
    >
      {BADGE_TONES[tone].icon}
    </span>
  );
};

// Inherits its size from the surrounding font size.
export const StepStateGlyph: React.FC<{ state: AiStep["state"] }> = ({
  state,
}) => {
  switch (state) {
    case "complete":
      return <FaCheck className="text-discord-green" />;
    case "failed":
      return <FaTimesCircle className="text-red-400" />;
    case "cancelled":
      return <FaTimes className="text-discord-text-muted" />;
    case "pending-approval":
      return <FaExclamation className="text-amber-400" />;
    default:
      return <FaSpinner className="text-blue-400 animate-spin" />;
  }
};

export default WorkflowStatusBadge;
