import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import {
  FaChevronRight,
  FaCommentAlt,
  FaExpandAlt,
  FaLightbulb,
  FaWrench,
} from "react-icons/fa";
import {
  isStepGroupRunning,
  type StepGroup,
  stepGroupState,
  stepGroupSteps,
} from "../../lib/botTools";
import { formatFileSize } from "../../lib/mediaUpload";
import {
  contentAsText,
  formatDuration,
  parseStepContent,
  type StepContent,
  summarizeArguments,
} from "../../lib/workflowFormat";
import type { AiStep } from "../../store";
import CodePanel from "./CodePanel";
import CopyButton from "./CopyButton";
import StepContentView from "./StepContentView";
import { StepStateGlyph } from "./WorkflowStatusBadge";

export type WorkflowAction = "cancel" | "approve" | "reject";

interface WorkflowStepRowProps {
  group: StepGroup;
  now: number;
  isOpen: boolean;
  isSheet: boolean;
  onToggle: () => void;
  onOpenViewer: (content: StepContent, title: string) => void;
  onSendAction: (action: WorkflowAction, target: string) => void;
}

const StepPanel: React.FC<{
  label: React.ReactNode;
  step: AiStep;
  viewerTitle: string;
  onOpenViewer: (content: StepContent, title: string) => void;
}> = ({ label, step, viewerTitle, onOpenViewer }) => {
  const { t } = useLingui();
  const content = parseStepContent(step.content);
  const text = content.kind === "json" ? content.raw : content.text;
  const isCut =
    !!step.truncated || (content.kind === "text" && content.looksCut);
  return (
    <CodePanel
      label={label}
      meta={formatFileSize(new TextEncoder().encode(text).length)}
      actions={
        <>
          <button
            type="button"
            className="icon-button w-6 h-6"
            title={t`Open in viewer`}
            aria-label={t`Open in viewer`}
            onClick={() => onOpenViewer(content, viewerTitle)}
          >
            <FaExpandAlt className="text-[11px]" />
          </button>
          <CopyButton getText={() => text} className="w-6 h-6 text-[11px]" />
        </>
      }
    >
      <StepContentView content={content} />
      {isCut && (
        <div className="mt-1 text-discord-text-muted">
          <Trans>truncated</Trans>
        </div>
      )}
    </CodePanel>
  );
};

export const WorkflowStepRow: React.FC<WorkflowStepRowProps> = ({
  group,
  now,
  isOpen,
  isSheet,
  onToggle,
  onOpenViewer,
  onSendAction,
}) => {
  const { t } = useLingui();
  const steps = stepGroupSteps(group);
  const first = steps[0];
  const last = steps.at(-1) ?? first;
  const isRunning = isStepGroupRunning(group);
  const isTool = group.kind === "tool-pair";
  const isReasoning =
    group.kind === "single" && group.step.type === "reasoning";
  const name = isTool
    ? (first?.tool ?? t`tool`)
    : isReasoning
      ? t`Reasoning`
      : (first?.label ?? t`Reply`);
  const duration = formatDuration(
    (isRunning ? now : last.updatedAt) - first.startedAt,
  );
  const approvalSid = steps.find((s) => s.state === "pending-approval")?.sid;
  const actionButtonSize = isSheet ? "h-11 px-5" : "h-8 px-3.5";

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`w-full flex items-center gap-2.5 px-2 rounded text-left transition-colors hover:bg-discord-dark-500/30 ${
          isSheet ? "min-h-12" : "py-1.5"
        } ${isRunning ? "bg-blue-500/10" : ""}`}
      >
        <span
          className={`w-4 flex justify-center text-sm ${
            isTool
              ? "text-cyan-300"
              : isReasoning
                ? "text-purple-300"
                : "text-discord-text-muted"
          }`}
        >
          {isTool ? (
            <FaWrench />
          ) : isReasoning ? (
            <FaLightbulb />
          ) : (
            <FaCommentAlt />
          )}
        </span>
        <span
          className={`text-sm font-medium truncate shrink-0 max-w-[45%] ${
            isReasoning ? "text-discord-text-muted" : "text-white"
          }`}
        >
          {name}
        </span>
        <span className="row-meta flex-1 min-w-0 truncate">
          {isTool
            ? summarizeArguments(group.call?.content)
            : contentAsText(first?.content ?? "").split("\n")[0]}
        </span>
        <span className="row-meta shrink-0">{duration}</span>
        <span className="w-3 flex justify-center shrink-0 text-[11px]">
          <StepStateGlyph state={stepGroupState(group)} />
        </span>
        <FaChevronRight
          className={`text-[10px] text-discord-text-muted shrink-0 transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        />
      </button>
      {isOpen && (
        <div className="ml-8 mr-2 mt-1 mb-2.5 flex flex-col gap-2.5">
          {group.kind === "single" && group.step.content != null && (
            <StepPanel
              label={name}
              step={group.step}
              viewerTitle={name}
              onOpenViewer={onOpenViewer}
            />
          )}
          {group.kind === "tool-pair" && group.call?.content != null && (
            <StepPanel
              label={<Trans>Input</Trans>}
              step={group.call}
              viewerTitle={t`${name} · input`}
              onOpenViewer={onOpenViewer}
            />
          )}
          {group.kind === "tool-pair" && group.result?.content != null && (
            <StepPanel
              label={<Trans>Output</Trans>}
              step={group.result}
              viewerTitle={t`${name} · output`}
              onOpenViewer={onOpenViewer}
            />
          )}
          {group.kind === "tool-pair" && !group.result && isRunning && (
            <div className="code-panel px-3 py-2 text-xs text-discord-text-muted">
              <Trans>running</Trans>
            </div>
          )}
          {approvalSid && (
            <div className="rounded-md p-3 bg-amber-400/[0.07] ring-1 ring-inset ring-amber-400/30 flex flex-col gap-2">
              <span className="text-xs text-discord-text-muted">
                <Trans>Run {name}?</Trans>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSendAction("approve", approvalSid)}
                  className={`${actionButtonSize} rounded text-sm font-semibold button-primary`}
                >
                  <Trans>Approve</Trans>
                </button>
                <button
                  type="button"
                  onClick={() => onSendAction("reject", approvalSid)}
                  className={`${actionButtonSize} rounded text-sm font-semibold bg-discord-dark-500/40 text-discord-text-normal hover:bg-red-600 hover:text-white`}
                >
                  <Trans>Reject</Trans>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowStepRow;
