import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { FaProjectDiagram } from "react-icons/fa";
import {
  AI_TOOLS_TAG,
  countableSteps,
  decodeAiToolsValue,
} from "../../lib/aiTools";
import useStore from "../../store";

interface AiToolsMessagePillProps {
  serverId: string;
  tags?: Record<string, string>;
}

// A bare clickable icon shown in the avatar-gutter to the left of an
// AI bot's chat reply. Step count + name live on the floating workflow
// card and the history popover; this is just a "reopen this run"
// affordance, sized to sit cleanly in the gutter without pushing the
// message body sideways. Caller is expected to position it absolutely
// (see MessageItem).
export const AiToolsMessagePill: React.FC<AiToolsMessagePillProps> = ({
  serverId,
  tags,
}) => {
  const { t } = useLingui();
  const rawTag = tags?.[AI_TOOLS_TAG];

  const workflowId = useMemo(() => {
    if (!rawTag) return undefined;
    const decoded = decodeAiToolsValue(rawTag);
    if (!decoded) return undefined;
    if (decoded.msg === "workflow") return decoded.id;
    if (decoded.msg === "step") return decoded.wid;
    return undefined;
  }, [rawTag]);

  const workflow = useStore((s) =>
    workflowId ? s.aiWorkflows[serverId]?.[workflowId] : undefined,
  );
  const reopen = useStore((s) => s.aiWorkflowReopen);
  const selectServer = useStore((s) => s.selectServer);

  if (!workflowId) return null;

  const available = !!workflow;
  const stepCount = workflow ? countableSteps(workflow.steps) : 0;

  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => {
        if (!available || !workflow) return;
        if (workflow.channel?.startsWith("#")) {
          selectServer(workflow.serverId);
        }
        reopen(workflow.serverId, workflow.id);
      }}
      className={`inline-flex items-center justify-center w-3.5 h-3.5 transition-colors ${
        available
          ? "text-discord-text-muted hover:text-white cursor-pointer"
          : "text-discord-text-muted/40 cursor-not-allowed"
      }`}
      title={
        available
          ? t`Reopen the workflow that produced this message (${stepCount} steps)`
          : t`The workflow that produced this message is no longer in state`
      }
    >
      <FaProjectDiagram className="text-[10px]" />
    </button>
  );
};

export default AiToolsMessagePill;
