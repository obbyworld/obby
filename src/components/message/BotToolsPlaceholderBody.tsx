import { Trans, useLingui } from "@lingui/react/macro";
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

const MAX_PARAM_VALUE_CHARS = 10;

function truncateValue(v: unknown): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (v == null) return "";
  else s = JSON.stringify(v) ?? "";
  return s.length > MAX_PARAM_VALUE_CHARS
    ? `${s.slice(0, MAX_PARAM_VALUE_CHARS - 1)}…`
    : s;
}

interface ParamPair {
  key: string;
  value: string;
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

// Render the tool-call's params object as a single truncated string the
// pill can wear. The bot publishes them as arbitrary JSON, so this is
// Decode the tool-call's `content` (arbitrary JSON the bot publishes)
// into ParamPair[] for pill rendering.  Each value is truncated to 10
// characters; the key is shown verbatim.  Primitive / string content is
// surfaced as a single anonymous pair.
function paramPairs(content: unknown): ParamPair[] {
  if (content == null) return [];
  if (
    typeof content === "string" ||
    typeof content === "number" ||
    typeof content === "boolean"
  ) {
    return [{ key: "", value: truncateValue(content) }];
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    const out: ParamPair[] = [];
    for (const [k, v] of Object.entries(content as Record<string, unknown>)) {
      if (v == null || v === "") continue;
      out.push({ key: k, value: truncateValue(v) });
    }
    return out;
  }
  if (Array.isArray(content)) {
    return content.slice(0, 4).map((v, i) => ({
      key: String(i),
      value: truncateValue(v),
    }));
  }
  return [];
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
  const { t } = useLingui();
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
        <div className="flex flex-wrap gap-1 pl-4">
          {callSteps.map((step) => {
            const pairs = paramPairs(step.content);
            const tool = step.tool ?? step.label ?? t`tool`;
            const tooltip = pairs.length
              ? `${tool}(${pairs.map((p) => (p.key ? `${p.key}=${p.value}` : p.value)).join(", ")})`
              : tool;
            return (
              <span
                key={step.sid}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-discord-dark-300 border border-discord-dark-400 not-italic max-w-full"
                title={tooltip}
              >
                <span className="shrink-0">{stepGlyph(step.state)}</span>
                <span className="text-discord-text-normal text-[11px] font-mono shrink-0">
                  {tool}
                </span>
                {pairs.map((p) => (
                  <span
                    key={`${step.sid}-${p.key}`}
                    className="text-discord-text-muted text-[11px] font-mono inline-flex items-center gap-0.5"
                  >
                    {p.key && (
                      <span className="text-discord-text-muted/60">
                        {p.key}=
                      </span>
                    )}
                    <span className="text-discord-text-normal">{p.value}</span>
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BotToolsPlaceholderBody;
