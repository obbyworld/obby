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

interface BotToolsPlaceholderBodyProps {
  serverId: string;
  workflowId: string;
}

const MAX_PARAM_CHARS = 32;

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

// Render the tool-call's params object as a single truncated string the
// pill can wear. The bot publishes them as arbitrary JSON, so this is
// best-effort: prefer a `query` / `q` / `prompt` / `path` / `cmd` field
// because those carry the most signal, otherwise compact-JSON the whole
// thing.  Never renders raw HTML; the pill's `truncate` class clips at
// the box.
function paramSummary(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") {
    return content.length > MAX_PARAM_CHARS
      ? `${content.slice(0, MAX_PARAM_CHARS - 1)}…`
      : content;
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    for (const key of ["query", "q", "prompt", "path", "cmd", "name", "url"]) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 0) {
        return v.length > MAX_PARAM_CHARS
          ? `${v.slice(0, MAX_PARAM_CHARS - 1)}…`
          : v;
      }
    }
    try {
      const json = JSON.stringify(content);
      return json.length > MAX_PARAM_CHARS
        ? `${json.slice(0, MAX_PARAM_CHARS - 1)}…`
        : json;
    } catch {
      return "";
    }
  }
  return "";
}

// While a workflow is running, the bot's PRIVMSG row is a placeholder
// (no content yet -- the final message lands as a morph at workflow
// complete).  We show the bot's workflow name on one line, then a
// horizontally-scrollable row of tool-call pills that accumulate as
// the bot calls each tool.  Each pill carries the tool's name + a
// truncated rendering of its params so the user can see what's being
// done without the data flying past.
export const BotToolsPlaceholderBody: React.FC<
  BotToolsPlaceholderBodyProps
> = ({ serverId, workflowId }) => {
  const workflow = useStore((s) => s.aiWorkflows[serverId]?.[workflowId]);

  if (!workflow) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-discord-text-muted italic">
        <FaSpinner className="animate-spin text-[10px]" />
        <Trans>Starting workflow…</Trans>
      </div>
    );
  }

  // Pull out the tool-call (and tool-result) steps in arrival order.
  // tool-result entries with the same `tool` as a preceding tool-call
  // update that pill's state in place rather than appending; that way
  // the row stays a stable left-to-right cascade of the tools used,
  // not a duplicated call/result pair per tool.
  const callSteps: AiStep[] = [];
  for (const step of workflow.steps) {
    if (step.type === "tool-call") {
      callSteps.push(step);
    } else if (step.type === "tool-result" && step.tool) {
      // Find the most recent call for this tool and merge state across.
      for (let i = callSteps.length - 1; i >= 0; i--) {
        if (callSteps[i].tool === step.tool) {
          callSteps[i] = {
            ...callSteps[i],
            state: step.state,
            updatedAt: step.updatedAt,
          };
          break;
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-1 text-xs italic text-discord-text-muted min-w-0">
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
      {callSteps.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1 -mb-1 max-w-full pl-4">
          {callSteps.map((step) => {
            const params = paramSummary(step.content);
            const tool = step.tool ?? step.label ?? "tool";
            return (
              <span
                key={step.sid}
                className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full bg-discord-dark-300 border border-discord-dark-400 not-italic"
                title={params ? `${tool} · ${params}` : tool}
              >
                <span className="shrink-0">{stepGlyph(step.state)}</span>
                <span className="text-discord-text-normal text-[11px] font-mono">
                  {tool}
                </span>
                {params && (
                  <span className="text-discord-text-muted text-[11px] font-mono max-w-[18ch] truncate">
                    {params}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BotToolsPlaceholderBody;
