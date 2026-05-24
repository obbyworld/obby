import { Trans } from "@lingui/react/macro";
import type React from "react";
import {
  FaCheck,
  FaExclamationTriangle,
  FaSpinner,
  FaTimes,
  FaTimesCircle,
} from "react-icons/fa";
import type { AiStep } from "../../store";
import useStore from "../../store";

interface AiToolsPlaceholderBodyProps {
  serverId: string;
  workflowId: string;
}

function stepGlyph(state: AiStep["state"]) {
  switch (state) {
    case "complete":
      return <FaCheck className="text-green-400 text-[10px]" />;
    case "failed":
      return <FaTimesCircle className="text-red-400 text-[10px]" />;
    case "cancelled":
      return <FaTimes className="text-discord-text-muted text-[10px]" />;
    case "pending-approval":
      return <FaExclamationTriangle className="text-yellow-400 text-[10px]" />;
    default:
      return (
        <FaSpinner className="text-discord-text-muted text-[10px] animate-spin" />
      );
  }
}

function stepLabel(step: AiStep): string {
  if (step.label) return step.label;
  if (step.type === "tool-call" || step.type === "tool-result")
    return step.tool ?? step.type;
  if (step.type === "thinking") return "Thinking";
  return "Text";
}

export const AiToolsPlaceholderBody: React.FC<AiToolsPlaceholderBodyProps> = ({
  serverId,
  workflowId,
}) => {
  const workflow = useStore((s) => s.aiWorkflows[serverId]?.[workflowId]);

  if (!workflow) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-discord-text-muted italic">
        <FaSpinner className="animate-spin text-[10px]" />
        <Trans>Starting workflow…</Trans>
      </div>
    );
  }

  const lastStep = workflow.steps[workflow.steps.length - 1];

  return (
    <div className="inline-flex flex-col gap-0.5 text-xs italic text-discord-text-muted">
      <div className="inline-flex items-center gap-2">
        <FaSpinner className="animate-spin text-[10px]" />
        {workflow.name ? (
          <span className="not-italic text-discord-text-normal">
            {workflow.name}
          </span>
        ) : (
          <Trans>Working…</Trans>
        )}
      </div>
      {lastStep && (
        <div className="inline-flex items-center gap-1.5 pl-4">
          <span className="shrink-0">{stepGlyph(lastStep.state)}</span>
          <span className="not-italic truncate max-w-[40ch]">
            {stepLabel(lastStep)}
          </span>
        </div>
      )}
    </div>
  );
};

export default AiToolsPlaceholderBody;
