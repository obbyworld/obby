import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaExclamationTriangle,
  FaProjectDiagram,
  FaSpinner,
  FaTimes,
  FaTimesCircle,
} from "react-icons/fa";
import type { AiStep, AiWorkflow } from "../../store";
import useStore from "../../store";

// Scroll the chat-side message with the given internal id into view and
// run the same .message-flash highlight that reply-jump uses, so the
// deep link from the workflow card lands somewhere attention-grabbing.
function scrollToMessageId(internalId: string): boolean {
  const el = document.querySelector(`[data-message-id="${internalId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("message-flash");
  setTimeout(() => el.classList.remove("message-flash"), 2000);
  return true;
}

interface AiToolsCardProps {
  workflow: AiWorkflow;
}

const STEP_TYPE_ACCENT: Record<string, string> = {
  thinking: "bg-purple-400",
  "tool-call": "bg-cyan-400",
  "tool-result": "bg-emerald-400",
  text: "bg-discord-text-muted",
};

function workflowHeaderIcon(state: AiWorkflow["state"]) {
  switch (state) {
    case "complete":
      return <FaCheck className="text-green-400" />;
    case "failed":
      return <FaTimesCircle className="text-red-400" />;
    case "cancelled":
      return <FaExclamationTriangle className="text-yellow-400" />;
    default:
      return <FaSpinner className="text-discord-text-muted animate-spin" />;
  }
}

// Render an arbitrary JSON value as a nested set of badges. Primitives
// become inline coloured chips; arrays and objects nest under a tinted
// left rule with their entries laid out one-per-row.  Designed for the
// tool-call args dump in particular, where flat `JSON.stringify` is
// hard to scan once nesting deepens.
const JsonBadges: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null)
    return (
      <span className="text-discord-text-muted italic font-mono text-xs">
        null
      </span>
    );
  if (typeof value === "string")
    return (
      <span className="text-emerald-300 font-mono text-xs break-words">
        &quot;{value}&quot;
      </span>
    );
  if (typeof value === "number")
    return <span className="text-cyan-300 font-mono text-xs">{value}</span>;
  if (typeof value === "boolean")
    return (
      <span className="text-purple-300 font-mono text-xs">{String(value)}</span>
    );
  if (Array.isArray(value)) {
    if (value.length === 0)
      return (
        <span className="text-discord-text-muted font-mono text-xs">[ ]</span>
      );
    return (
      <div className="flex flex-col gap-1 mt-0.5 pl-2 border-l-2 border-discord-primary/40">
        {value.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: index is the only stable id for a positional array entry here
          <div key={i} className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[10px] font-mono text-discord-text-muted shrink-0">
              [{i}]
            </span>
            <div className="flex-1 min-w-0">
              <JsonBadges value={v} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0)
      return (
        <span className="text-discord-text-muted font-mono text-xs">
          {"{ }"}
        </span>
      );
    return (
      <div className="flex flex-col gap-1">
        {entries.map(([k, v]) => {
          const isContainer =
            v !== null && typeof v === "object" && Object.keys(v).length > 0;
          return (
            <div
              key={k}
              className={`flex ${isContainer ? "flex-col" : "items-baseline"} gap-1.5 min-w-0`}
            >
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-discord-dark-400/80 text-[10px] uppercase tracking-wide text-discord-text-muted font-mono shrink-0 self-start">
                {k}
              </span>
              <div className="flex-1 min-w-0">
                <JsonBadges value={v} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return <span className="font-mono text-xs">{String(value)}</span>;
};

// Render an AiStep's content payload (string or JSON) in the same
// monospace box style used everywhere else in the card.
const ContentBox: React.FC<{ content: unknown }> = ({ content }) => {
  if (content === undefined || content === null) return null;
  if (typeof content === "string") {
    return (
      <pre className="text-xs leading-snug text-discord-text-normal whitespace-pre-wrap break-words font-mono bg-discord-dark-500/70 rounded px-2.5 py-1.5">
        {content}
      </pre>
    );
  }
  // Tool-call args (and any other structured payload) — render as
  // recursive badges. A flat <pre> JSON dump is hard to scan once
  // arguments grow nested; a key→value chip tree mirrors how the
  // model actually thought about the call.
  return (
    <div className="bg-discord-dark-500/70 rounded px-2.5 py-1.5">
      <JsonBadges value={content} />
    </div>
  );
};

function stepStateGlyph(state: AiStep["state"]) {
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

const StepRow: React.FC<{
  accent: string;
  isFirst: boolean;
  isLast: boolean;
  children: React.ReactNode;
}> = ({ accent, isFirst, isLast, children }) => (
  <div className="flex gap-2.5 py-2 pr-3 pl-2">
    <div className="relative w-2 flex justify-center shrink-0" aria-hidden>
      {/* Vertical connector line: spans the full row height so
          consecutive rows visually join; clipped on the first /
          last row so it doesn't hang past the outermost dots. */}
      <span
        className={`absolute left-1/2 -translate-x-1/2 w-px bg-discord-dark-400 ${
          isFirst ? "top-[14px]" : "top-0"
        } ${isLast ? "h-[6px]" : "bottom-0"}`}
      />
      <span className={`relative mt-1.5 w-2 h-2 rounded-full ${accent}`} />
    </div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

// Render a single thinking / text step. Colored dot, terse header,
// then the content payload in a mono box if present.
const Step: React.FC<{
  step: AiStep;
  isFirst: boolean;
  isLast: boolean;
}> = ({ step, isFirst, isLast }) => {
  const accent = STEP_TYPE_ACCENT[step.type] ?? STEP_TYPE_ACCENT.text;

  const headerKind =
    step.type === "thinking" ? <Trans>Thinking</Trans> : <Trans>Text</Trans>;

  return (
    <StepRow accent={accent} isFirst={isFirst} isLast={isLast}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-discord-text-muted">
          {headerKind}
        </span>
        {step.label && (
          <span className="text-sm font-medium text-white truncate">
            {step.label}
          </span>
        )}
        <span className="ml-auto shrink-0">{stepStateGlyph(step.state)}</span>
      </div>
      {step.content !== undefined && step.content !== null && (
        <div className="mt-1.5">
          <ContentBox content={step.content} />
        </div>
      )}
      {step.truncated && (
        <div className="mt-1 text-[10px] text-yellow-400">
          <Trans>output truncated</Trans>
        </div>
      )}
    </StepRow>
  );
};

// Render a tool-call together with its matching tool-result as a
// single row -- one header (the tool name), then IN (call args) and
// OUT (result) stacked below. Either side may be absent during the
// in-between window after the call lands and before the result
// arrives.
const ToolPairStep: React.FC<{
  call?: AiStep;
  result?: AiStep;
  isFirst: boolean;
  isLast: boolean;
}> = ({ call, result, isFirst, isLast }) => {
  const accent = STEP_TYPE_ACCENT["tool-call"];
  const primary = result ?? call;
  const tool = primary?.tool ?? "tool";
  const label = primary?.label;
  const state = primary?.state ?? "running";
  const truncated = call?.truncated || result?.truncated;

  return (
    <StepRow accent={accent} isFirst={isFirst} isLast={isLast}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-discord-text-muted">
          <Trans>Tool</Trans>
        </span>
        <span className="text-sm font-medium text-white truncate">{tool}</span>
        {label && (
          <span className="text-xs text-discord-text-muted truncate">
            {label}
          </span>
        )}
        <span className="ml-auto shrink-0">{stepStateGlyph(state)}</span>
      </div>
      {call?.content !== undefined && call?.content !== null && (
        <div className="mt-1.5">
          <div className="text-[9px] uppercase tracking-wider text-discord-text-muted/70 mb-0.5 ml-0.5">
            <Trans>IN</Trans>
          </div>
          <ContentBox content={call.content} />
        </div>
      )}
      {result?.content !== undefined && result?.content !== null && (
        <div className="mt-1.5">
          <div className="text-[9px] uppercase tracking-wider text-discord-text-muted/70 mb-0.5 ml-0.5">
            <Trans>OUT</Trans>
          </div>
          <ContentBox content={result.content} />
        </div>
      )}
      {truncated && (
        <div className="mt-1 text-[10px] text-yellow-400">
          <Trans>output truncated</Trans>
        </div>
      )}
    </StepRow>
  );
};

type RenderItem =
  | { kind: "single"; key: string; step: AiStep }
  | {
      kind: "tool-pair";
      key: string;
      call?: AiStep;
      result?: AiStep;
      approvalSid?: string;
    };

function buildRenderItems(steps: AiStep[]): RenderItem[] {
  const items: RenderItem[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < steps.length; i++) {
    if (paired.has(i)) continue;
    const s = steps[i];
    if (s.type === "tool-call") {
      let result: AiStep | undefined;
      for (let j = i + 1; j < steps.length; j++) {
        if (paired.has(j)) continue;
        const t = steps[j];
        if (t.type === "tool-result" && t.tool === s.tool) {
          result = t;
          paired.add(j);
          break;
        }
      }
      items.push({
        kind: "tool-pair",
        key: s.sid,
        call: s,
        result,
        approvalSid:
          s.state === "pending-approval"
            ? s.sid
            : result?.state === "pending-approval"
              ? result.sid
              : undefined,
      });
    } else if (s.type === "tool-result") {
      // tool-result with no preceding tool-call: render standalone
      items.push({
        kind: "tool-pair",
        key: s.sid,
        result: s,
        approvalSid: s.state === "pending-approval" ? s.sid : undefined,
      });
    } else {
      items.push({ kind: "single", key: s.sid, step: s });
    }
  }
  return items;
}

export const AiToolsCard: React.FC<AiToolsCardProps> = ({ workflow }) => {
  const { t } = useLingui();
  const setCollapsed = useStore((s) => s.aiWorkflowSetCollapsed);
  const dismiss = useStore((s) => s.aiWorkflowDismiss);
  const sendAction = useStore((s) => s.aiSendAction);
  // For "Responded in chat" — map the workflow's finalMsgid (an IRC
  // msgid string) to the internal Message.id we use as the DOM key.
  // Only takes a single string out of the store so we don't re-render
  // the card on every unrelated message arrival.
  const finalMessageInternalId = useStore((s) => {
    if (!workflow.finalMsgid) return undefined;
    for (const bucket of Object.values(s.messages)) {
      for (const m of bucket) {
        if (
          m.serverId === workflow.serverId &&
          m.msgid === workflow.finalMsgid
        ) {
          return m.id;
        }
      }
    }
    return undefined;
  });

  const isTerminal =
    workflow.state === "complete" ||
    workflow.state === "failed" ||
    workflow.state === "cancelled";

  const onToggle = () =>
    setCollapsed(workflow.serverId, workflow.id, !workflow.collapsed);

  const onCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendAction(workflow.serverId, workflow.senderNick, {
      msg: "action",
      action: "cancel",
      target: workflow.id,
    });
  };

  const onApprove = (sid: string) => {
    sendAction(workflow.serverId, workflow.senderNick, {
      msg: "action",
      action: "approve",
      target: sid,
    });
  };

  const onReject = (sid: string) => {
    sendAction(workflow.serverId, workflow.senderNick, {
      msg: "action",
      action: "reject",
      target: sid,
    });
  };

  const pendingApprovals = workflow.steps.filter(
    (s) => s.state === "pending-approval",
  );

  // Auto-dismiss countdown — once a workflow is terminal AND collapsed,
  // start a 5s countdown. The user can re-expand or hover to pause.
  // Expanding the card resets the timer entirely (they're reviewing the
  // run); collapsing again restarts it.
  const FADE_SECONDS = 5;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!isTerminal || !workflow.collapsed) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(FADE_SECONDS);
  }, [isTerminal, workflow.collapsed]);
  useEffect(() => {
    if (secondsLeft === null || paused) return;
    if (secondsLeft <= 0) {
      dismiss(workflow.serverId, workflow.id);
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s ?? 0) - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, paused, dismiss, workflow.serverId, workflow.id]);

  // Auto-scroll the expanded step list.  We can't check "is the user
  // at the bottom?" inside the content-update effect, because by the
  // time the effect runs the new content has already grown
  // scrollHeight and the old scrollTop no longer qualifies as
  // bottom.  Instead, track stickiness via the scroll event: whenever
  // the user scrolls (or we programmatically scroll), recompute
  // whether they're at the bottom.  On content update, honour that
  // flag.  Reset to sticky on each fresh expansion so a freshly-
  // opened card always lands on the latest content.
  const bodyRef = useRef<HTMLDivElement>(null);
  const isStickyToBottom = useRef(true);
  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const SCROLL_TOLERANCE = 24;
    isStickyToBottom.current =
      el.scrollHeight - (el.scrollTop + el.clientHeight) <= SCROLL_TOLERANCE;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track step count + updatedAt because step content updates don't change the array reference
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || workflow.collapsed) {
      isStickyToBottom.current = true;
      return;
    }
    if (isStickyToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [workflow.collapsed, workflow.steps.length, workflow.updatedAt]);

  // Linearly fade the card from full opacity to a barely-visible
  // ghost over the entire countdown.  Bottoms out at 0.15 so a
  // re-hover (which pauses the timer) doesn't land on an invisible
  // target.
  const fadeOpacity =
    secondsLeft !== null ? Math.max(0.15, secondsLeft / FADE_SECONDS) : 1;

  return (
    <div
      style={{ opacity: fadeOpacity, transition: "opacity 0.8s linear" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="w-[680px] max-w-full bg-discord-dark-300/95 backdrop-blur-sm border border-discord-dark-400 rounded-lg shadow-xl overflow-hidden"
    >
      {/* Header — collapsed row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-discord-dark-400/60 transition-colors text-left"
        aria-expanded={!workflow.collapsed}
      >
        <span className="w-6 h-6 flex items-center justify-center shrink-0">
          {workflowHeaderIcon(workflow.state)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
            <FaProjectDiagram className="text-[10px] text-discord-text-muted shrink-0" />
            {workflow.senderNick}
          </div>
          {workflow.name && (
            <div className="text-xs text-discord-text-muted truncate">
              {workflow.name}
            </div>
          )}
          {workflow.prompt && (
            <div className="text-[11px] text-discord-text-muted/80 italic truncate mt-0.5">
              &ldquo;{workflow.prompt}&rdquo;
            </div>
          )}
        </div>
        {isTerminal && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(workflow.serverId, workflow.id);
            }}
            className="text-discord-text-muted hover:text-white p-1 rounded"
            aria-label={t`Dismiss`}
          >
            <FaTimes className="text-xs" />
          </button>
        )}
        {!isTerminal && (
          <button
            type="button"
            onClick={onCancel}
            className="text-discord-text-muted hover:text-red-400 px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded"
            aria-label={t`Cancel workflow`}
          >
            <Trans>Stop</Trans>
          </button>
        )}
        <span className="text-discord-text-muted shrink-0 ml-1">
          {workflow.collapsed ? (
            <FaChevronDown className="text-xs" />
          ) : (
            <FaChevronUp className="text-xs" />
          )}
        </span>
      </button>

      {/* Countdown drain on a collapsed, terminal card */}
      {secondsLeft !== null && (
        <div className="h-0.5 bg-discord-dark-400 overflow-hidden">
          <div
            className="h-full bg-primary/60"
            style={{
              width: `${(Math.max(0, secondsLeft) / FADE_SECONDS) * 100}%`,
              transition: "width 1s linear",
            }}
            title={t`Auto-dismiss in ${secondsLeft}s`}
          />
        </div>
      )}

      {/* Expanded body — step list. No horizontal divider between
          steps -- a vertical connector through the dot column does
          the same job and reads more like a pipeline. */}
      {!workflow.collapsed && (
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          className="border-t border-discord-dark-400 max-h-[420px] overflow-y-auto"
        >
          {workflow.steps.length === 0 ? (
            <div className="px-3 py-4 text-xs text-discord-text-muted">
              <Trans>Waiting for first step…</Trans>
            </div>
          ) : (
            (() => {
              const items = buildRenderItems(workflow.steps);
              return items.map((item, i) => {
                const isFirst = i === 0;
                const isLast = i === items.length - 1;
                return (
                  <div key={item.key}>
                    {item.kind === "single" ? (
                      <Step
                        step={item.step}
                        isFirst={isFirst}
                        isLast={isLast}
                      />
                    ) : (
                      <ToolPairStep
                        call={item.call}
                        result={item.result}
                        isFirst={isFirst}
                        isLast={isLast}
                      />
                    )}
                    {item.kind === "tool-pair" && item.approvalSid && (
                      <div className="flex items-center gap-2 px-3 pb-3 -mt-1">
                        <button
                          type="button"
                          onClick={() => onApprove(item.approvalSid as string)}
                          className="flex-1 px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                        >
                          <Trans>Approve</Trans>
                        </button>
                        <button
                          type="button"
                          onClick={() => onReject(item.approvalSid as string)}
                          className="flex-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                        >
                          <Trans>Reject</Trans>
                        </button>
                      </div>
                    )}
                    {item.kind === "single" &&
                      item.step.state === "pending-approval" && (
                        <div className="flex items-center gap-2 px-3 pb-3 -mt-1">
                          <button
                            type="button"
                            onClick={() => onApprove(item.step.sid)}
                            className="flex-1 px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                          >
                            <Trans>Approve</Trans>
                          </button>
                          <button
                            type="button"
                            onClick={() => onReject(item.step.sid)}
                            className="flex-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                          >
                            <Trans>Reject</Trans>
                          </button>
                        </div>
                      )}
                  </div>
                );
              });
            })()
          )}
        </div>
      )}

      {/* Collapsed-state attention hint when an approval is pending */}
      {workflow.collapsed && pendingApprovals.length > 0 && (
        <div className="px-3 py-1.5 border-t border-discord-dark-400 bg-yellow-500/10 text-yellow-300 text-[11px] flex items-center gap-1.5">
          <FaExclamationTriangle className="shrink-0" />
          <Trans>{pendingApprovals.length} step(s) awaiting approval</Trans>
        </div>
      )}

      {/* Deep link to the bot's final PRIVMSG once it's landed in chat */}
      {isTerminal && workflow.finalMsgid && (
        <button
          type="button"
          onClick={() => {
            if (finalMessageInternalId)
              scrollToMessageId(finalMessageInternalId);
          }}
          disabled={!finalMessageInternalId}
          className="w-full px-3 py-1.5 border-t border-discord-dark-400 text-left text-[11px] text-discord-text-muted hover:text-white hover:bg-discord-dark-400/60 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            finalMessageInternalId
              ? t`Scroll chat to this response`
              : t`Response message is no longer in view`
          }
        >
          <FaArrowRight className="text-[9px] shrink-0" />
          <Trans>Responded in chat</Trans>
        </button>
      )}
    </div>
  );
};

export default AiToolsCard;
