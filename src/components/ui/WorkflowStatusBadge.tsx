import type React from "react";
import { FaCheck, FaSpinner, FaStop, FaTimes } from "react-icons/fa";
import type { AiWorkflow } from "../../store";

interface WorkflowStatusBadgeProps {
  state: AiWorkflow["state"];
  className?: string;
}

export const WorkflowStatusBadge: React.FC<WorkflowStatusBadgeProps> = ({
  state,
  className = "",
}) => {
  if (state === "complete")
    return (
      <span
        className={`status-badge bg-discord-green/15 text-discord-green ${className}`}
      >
        <FaCheck />
      </span>
    );
  if (state === "failed")
    return (
      <span className={`status-badge bg-red-500/15 text-red-400 ${className}`}>
        <FaTimes />
      </span>
    );
  if (state === "cancelled")
    return (
      <span
        className={`status-badge bg-discord-dark-500/40 text-discord-text-muted ${className}`}
      >
        <FaStop className="scale-75" />
      </span>
    );
  return (
    <span className={`status-badge bg-blue-500/15 text-blue-400 ${className}`}>
      <FaSpinner className="animate-spin" />
    </span>
  );
};

export default WorkflowStatusBadge;
