import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { FaSpinner } from "react-icons/fa";
import {
  countableSteps,
  effectiveWorkflowState,
  groupWorkflowSteps,
  isTerminalState,
  stepGroupState,
  stepGroupSteps,
} from "../../lib/botTools";
import { formatDuration } from "../../lib/workflowFormat";
import useStore from "../../store";
import { StepStateGlyph } from "../ui/WorkflowStatusBadge";

interface WorkflowLineProps {
  serverId: string;
  workflowId: string;
  isPending: boolean;
}

// One line per workflow in the chat, updated in place: the live step while it
// runs, a summary once it ends. The full run lives in the card the line opens.
export const WorkflowLine: React.FC<WorkflowLineProps> = ({
  serverId,
  workflowId,
  isPending,
}) => {
  const { t } = useLingui();
  const workflow = useStore((s) => s.aiWorkflows[serverId]?.[workflowId]);
  const reopen = useStore((s) => s.aiWorkflowReopen);

  if (!workflow) {
    return isPending ? (
      <div className="inline-flex items-center gap-2 row-meta italic">
        <FaSpinner className="animate-spin text-[10px]" />
        <Trans>Starting workflow…</Trans>
      </div>
    ) : null;
  }

  const state = effectiveWorkflowState(workflow);
  const isFinished = isTerminalState(state);
  const latest = groupWorkflowSteps(workflow.steps).at(-1);
  const latestStep = latest && stepGroupSteps(latest)[0];
  const latestName =
    latestStep?.tool ??
    latestStep?.label ??
    (latestStep?.type === "reasoning" ? t`Reasoning` : undefined);
  const stepCount = countableSteps(workflow.steps);

  return (
    <button
      type="button"
      onClick={() => reopen(serverId, workflowId)}
      title={t`Open workflow`}
      className="group chip-action max-w-full min-w-0 mb-1"
    >
      <span className="shrink-0 text-[10px] flex">
        {isFinished ? (
          <StepStateGlyph
            state={
              state === "complete" || state === "cancelled" ? state : "failed"
            }
          />
        ) : latest ? (
          <StepStateGlyph state={stepGroupState(latest)} />
        ) : (
          <FaSpinner className="animate-spin text-blue-400" />
        )}
      </span>
      <span className="shrink-0 text-white">
        {workflow.name ?? t`Workflow`}
      </span>
      {!isFinished && latestName && (
        <span className="truncate text-blue-400 group-hover:text-white">
          {latestName}
        </span>
      )}
      {stepCount > 0 && (
        <span className="row-meta shrink-0 group-hover:text-white">
          {plural(stepCount, { one: "# step", other: "# steps" })}
          {isFinished &&
            ` · ${formatDuration(workflow.updatedAt - workflow.startedAt)}`}
        </span>
      )}
    </button>
  );
};

export default WorkflowLine;
