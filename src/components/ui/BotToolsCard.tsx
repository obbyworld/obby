import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaChevronRight,
  FaChevronUp,
  FaCode,
  FaCommentAlt,
  FaExclamation,
  FaExpandAlt,
  FaLightbulb,
  FaListUl,
  FaRegCopy,
  FaSpinner,
  FaStop,
  FaTimes,
  FaTimesCircle,
  FaWrench,
} from "react-icons/fa";
import {
  effectiveWorkflowState,
  isTerminalState,
  WORKFLOW_TIMEOUT_MS,
} from "../../lib/botTools";
import {
  contentAsText,
  formatBytes,
  formatDuration,
  indentPartialJson,
  parseStepContent,
  type StepContent,
  summarizeArguments,
  workflowToJson,
  workflowToText,
} from "../../lib/workflowFormat";
import type { AiStep, AiWorkflow } from "../../store";
import useStore from "../../store";
import CodePanel from "./CodePanel";
import CopyButton from "./CopyButton";
import JsonTree, { JsonText } from "./JsonTree";
import Menu from "./Menu";
import WorkflowOutputViewer from "./WorkflowOutputViewer";
import WorkflowStatusBadge from "./WorkflowStatusBadge";

// Scroll the chat-side message with the given internal id into view and
// run the same .message-flash highlight that reply-jump uses.
function scrollToMessageId(internalId: string): boolean {
  const el = document.querySelector(`[data-message-id="${internalId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("message-flash");
  setTimeout(() => el.classList.remove("message-flash"), 2000);
  return true;
}

interface BotToolsCardProps {
  workflow: AiWorkflow;
  // "sheet" docks the card to the bottom of a touch screen.
  variant?: "floating" | "sheet";
}

type RenderItem =
  | { kind: "single"; key: string; step: AiStep }
  | { kind: "tool-pair"; key: string; call?: AiStep; result?: AiStep };

function buildRenderItems(steps: AiStep[]): RenderItem[] {
  const items: RenderItem[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < steps.length; i++) {
    if (paired.has(i)) continue;
    const s = steps[i];
    if (s.type === "tool-call") {
      const j = steps.findIndex(
        (t, k) =>
          k > i &&
          !paired.has(k) &&
          t.type === "tool-result" &&
          t.tool === s.tool,
      );
      if (j !== -1) paired.add(j);
      items.push({
        kind: "tool-pair",
        key: s.sid,
        call: s,
        result: j === -1 ? undefined : steps[j],
      });
    } else if (s.type === "tool-result") {
      items.push({ kind: "tool-pair", key: s.sid, result: s });
    } else {
      items.push({ kind: "single", key: s.sid, step: s });
    }
  }
  return items;
}

const itemSteps = (item: RenderItem): AiStep[] =>
  item.kind === "single"
    ? [item.step]
    : [item.call, item.result].filter((s): s is AiStep => !!s);

const itemState = (item: RenderItem): AiStep["state"] => {
  const steps = itemSteps(item);
  return steps[steps.length - 1]?.state ?? "running";
};

const SETTLED_STEP_STATES: ReadonlySet<AiStep["state"]> = new Set([
  "complete",
  "failed",
  "cancelled",
  "pending-approval",
]);

const isItemRunning = (item: RenderItem) =>
  !SETTLED_STEP_STATES.has(itemState(item));

// Re-render every second while something is live, so elapsed times tick.
function useNow(isLive: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isLive]);
  return now;
}

function StateGlyph({ state }: { state: AiStep["state"] }) {
  switch (state) {
    case "complete":
      return <FaCheck className="text-discord-green text-[11px]" />;
    case "failed":
      return <FaTimesCircle className="text-red-400 text-[11px]" />;
    case "cancelled":
      return <FaTimes className="text-discord-text-muted text-[11px]" />;
    case "pending-approval":
      return <FaExclamation className="text-amber-400 text-[11px]" />;
    default:
      return <FaSpinner className="text-blue-400 text-[11px] animate-spin" />;
  }
}

const ContentView: React.FC<{ content: StepContent }> = ({ content }) =>
  content.kind === "json" ? (
    <JsonTree value={content.value} />
  ) : content.looksCut ? (
    <JsonText text={indentPartialJson(content.text)} />
  ) : (
    <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-discord-text-normal">
      {content.text}
    </pre>
  );

const StepPanel: React.FC<{
  label: React.ReactNode;
  step: AiStep;
  viewerTitle: string;
  onOpenViewer: (content: StepContent, title: string) => void;
}> = ({ label, step, viewerTitle, onOpenViewer }) => {
  const { t } = useLingui();
  const content = parseStepContent(step.content);
  const text = contentAsText(step.content);
  const isCut =
    !!step.truncated || (content.kind === "text" && content.looksCut);
  return (
    <CodePanel
      label={label}
      meta={formatBytes(text)}
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
      <ContentView content={content} />
      {isCut && (
        <div className="mt-1 text-discord-text-muted">
          <Trans>truncated</Trans>
        </div>
      )}
    </CodePanel>
  );
};

export const BotToolsCard: React.FC<BotToolsCardProps> = ({
  workflow,
  variant = "floating",
}) => {
  const { t } = useLingui();
  const setCollapsed = useStore((s) => s.aiWorkflowSetCollapsed);
  const dismiss = useStore((s) => s.aiWorkflowDismiss);
  const sendAction = useStore((s) => s.aiSendAction);
  const finalMessageInternalId = useStore((s) => {
    if (!workflow.finalMsgid) return undefined;
    for (const bucket of Object.values(s.messages)) {
      for (const m of bucket) {
        if (m.serverId === workflow.serverId && m.msgid === workflow.finalMsgid)
          return m.id;
      }
    }
    return undefined;
  });

  const displayState = effectiveWorkflowState(workflow);
  const isTerminal = isTerminalState(displayState);
  const now = useNow(!isTerminal);
  const isSheet = variant === "sheet";

  // Re-render at the timeout boundary so a stuck run flips to "timed out".
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (isTerminalState(workflow.state)) return;
    const remaining = WORKFLOW_TIMEOUT_MS - (Date.now() - workflow.startedAt);
    if (remaining <= 0) return;
    const id = setTimeout(() => forceTick((n) => n + 1), remaining + 50);
    return () => clearTimeout(id);
  }, [workflow.state, workflow.startedAt]);

  const items = buildRenderItems(workflow.steps);
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const isItemOpen = (item: RenderItem) =>
    openKeys[item.key] ??
    (isItemRunning(item) ||
      itemState(item) === "failed" ||
      itemState(item) === "pending-approval");
  const toggleItem = (item: RenderItem) =>
    setOpenKeys((keys) => ({ ...keys, [item.key]: !isItemOpen(item) }));

  const [copyAnchor, setCopyAnchor] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<{
    content: StepContent;
    title: string;
  } | null>(null);

  const send = (action: "cancel" | "approve" | "reject", target: string) =>
    sendAction(workflow.serverId, workflow.senderNick, {
      msg: "action",
      action,
      target,
    });

  const pendingApprovals = workflow.steps.filter(
    (s) => s.state === "pending-approval",
  );
  const toolCount = items.filter((i) => i.kind === "tool-pair").length;
  const elapsed = formatDuration(
    (isTerminal ? workflow.updatedAt : now) - workflow.startedAt,
  );

  // Auto-dismiss countdown once a finished card is collapsed; hover pauses it.
  const FADE_SECONDS = 5;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    setSecondsLeft(isTerminal && workflow.collapsed ? FADE_SECONDS : null);
  }, [isTerminal, workflow.collapsed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dismiss is a Zustand action with unstable ref
  useEffect(() => {
    if (secondsLeft === null || isPaused) return;
    if (secondsLeft <= 0) {
      dismiss(workflow.serverId, workflow.id);
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => (s ?? 0) - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, isPaused, workflow.serverId, workflow.id]);

  // We keep the step list pinned to the bottom unless the user scrolled up.
  const bodyRef = useRef<HTMLDivElement>(null);
  const isStickyToBottom = useRef(true);
  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    isStickyToBottom.current =
      el.scrollHeight - (el.scrollTop + el.clientHeight) <= 24;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: step content updates keep the array reference, so we watch updatedAt
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || workflow.collapsed) {
      isStickyToBottom.current = true;
      return;
    }
    if (isStickyToBottom.current) el.scrollTop = el.scrollHeight;
  }, [workflow.collapsed, workflow.steps.length, workflow.updatedAt]);

  const fadeOpacity =
    secondsLeft !== null ? Math.max(0.15, secondsLeft / FADE_SECONDS) : 1;

  const statusLine = isTerminal ? (
    <Trans>
      {toolCount} steps · {elapsed}
    </Trans>
  ) : pendingApprovals.length > 0 ? (
    <span className="text-amber-400">
      <Trans>waiting for you</Trans>
    </span>
  ) : (
    <span className="text-blue-400">
      <Trans>running · {elapsed}</Trans>
    </span>
  );

  const renderItem = (item: RenderItem) => {
    const state = itemState(item);
    const isOpen = isItemOpen(item);
    const first = itemSteps(item)[0];
    const last = itemSteps(item).at(-1) ?? first;
    const isTool = item.kind === "tool-pair";
    const isReasoning =
      item.kind === "single" && item.step.type === "reasoning";
    const name = isTool
      ? (first?.tool ?? t`tool`)
      : isReasoning
        ? t`Reasoning`
        : (first?.label ?? t`Reply`);
    const summary = isTool
      ? summarizeArguments(item.call?.content)
      : contentAsText(first?.content ?? "").split("\n")[0];
    const duration = formatDuration(
      (isItemRunning(item) ? now : last.updatedAt) - first.startedAt,
    );
    const approvalSid = itemSteps(item).find(
      (s) => s.state === "pending-approval",
    )?.sid;

    return (
      <div key={item.key}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggleItem(item)}
          className={`w-full flex items-center gap-2.5 px-2 rounded text-left transition-colors hover:bg-discord-dark-500/30 ${
            isSheet ? "min-h-12" : "py-1.5"
          } ${isItemRunning(item) ? "bg-blue-500/10" : ""}`}
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
          <span className="row-meta flex-1 min-w-0 truncate">{summary}</span>
          <span className="row-meta shrink-0">{duration}</span>
          <span className="w-3 flex justify-center shrink-0">
            <StateGlyph state={state} />
          </span>
          <FaChevronRight
            className={`text-[10px] text-discord-text-muted shrink-0 transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </button>
        {isOpen && (
          <div className="ml-8 mr-2 mt-1 mb-2.5 flex flex-col gap-2.5">
            {item.kind === "single" && item.step.content != null && (
              <StepPanel
                label={name}
                step={item.step}
                viewerTitle={name}
                onOpenViewer={(content, title) => setViewer({ content, title })}
              />
            )}
            {item.kind === "tool-pair" && item.call?.content != null && (
              <StepPanel
                label={<Trans>Input</Trans>}
                step={item.call}
                viewerTitle={t`${name} · input`}
                onOpenViewer={(content, title) => setViewer({ content, title })}
              />
            )}
            {item.kind === "tool-pair" && item.result?.content != null && (
              <StepPanel
                label={<Trans>Output</Trans>}
                step={item.result}
                viewerTitle={t`${name} · output`}
                onOpenViewer={(content, title) => setViewer({ content, title })}
              />
            )}
            {item.kind === "tool-pair" &&
              !item.result &&
              isItemRunning(item) && (
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
                    onClick={() => send("approve", approvalSid)}
                    className="h-8 px-3.5 rounded text-sm font-semibold bg-discord-primary text-white hover:bg-discord-primary/80"
                  >
                    <Trans>Approve</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={() => send("reject", approvalSid)}
                    className="h-8 px-3.5 rounded text-sm font-semibold bg-discord-dark-500/40 text-discord-text-normal hover:bg-red-600 hover:text-white"
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

  return (
    <div
      style={{ opacity: fadeOpacity, transition: "opacity 0.8s linear" }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={
        isSheet
          ? "surface-sheet w-full"
          : "surface-floating w-full md:w-[680px] md:max-w-full overflow-hidden"
      }
    >
      {isSheet && <span className="sheet-handle" aria-hidden />}
      <div className="flex items-start gap-2.5 pl-3.5 pr-2 pt-3 pb-2.5">
        <WorkflowStatusBadge state={displayState} />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
            <span className="text-sm font-semibold text-white truncate max-w-full">
              {workflow.senderNick}
            </span>
            {workflow.name && (
              <span className="text-sm text-discord-text-muted truncate max-w-full">
                {workflow.name}
              </span>
            )}
            <span className="row-meta shrink-0">{statusLine}</span>
          </div>
          {workflow.prompt && (
            <span className="row-meta truncate">{workflow.prompt}</span>
          )}
        </div>
        {workflow.collapsed && pendingApprovals.length > 0 && (
          <span className="self-center shrink-0 text-[11px] font-semibold text-[#1a1300] bg-amber-400 rounded-full px-2 py-px">
            <Trans>needs approval</Trans>
          </span>
        )}
        {!isTerminal && (
          <button
            type="button"
            onClick={() => send("cancel", workflow.id)}
            className="h-7 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:bg-red-600 hover:text-white"
          >
            <FaStop className="text-[9px]" />
            <Trans>Stop</Trans>
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t`Copy workflow`}
          title={t`Copy workflow`}
          aria-haspopup="menu"
          aria-expanded={!!copyAnchor}
          onClick={(e) => setCopyAnchor(copyAnchor ? null : e.currentTarget)}
        >
          <FaRegCopy className="text-xs" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() =>
            setCollapsed(workflow.serverId, workflow.id, !workflow.collapsed)
          }
          aria-expanded={!workflow.collapsed}
          aria-label={
            workflow.collapsed ? t`Expand workflow` : t`Collapse workflow`
          }
          title={workflow.collapsed ? t`Expand workflow` : t`Collapse workflow`}
        >
          {workflow.collapsed ? <FaChevronDown /> : <FaChevronUp />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => dismiss(workflow.serverId, workflow.id)}
          aria-label={t`Close workflow`}
          title={t`Close workflow`}
        >
          <FaTimes className="text-xs" />
        </button>
      </div>

      {secondsLeft !== null && (
        <div className="h-0.5 bg-discord-dark-400 overflow-hidden">
          <div
            className="h-full bg-blue-500/60"
            style={{
              width: `${(Math.max(0, secondsLeft) / FADE_SECONDS) * 100}%`,
              transition: "width 1s linear",
            }}
            title={t`Auto-dismiss in ${secondsLeft}s`}
          />
        </div>
      )}

      {!workflow.collapsed && (
        <>
          <div className="hairline mx-3" />
          <div
            ref={bodyRef}
            onScroll={onBodyScroll}
            className={`p-1.5 overflow-y-auto ${isSheet ? "max-h-[60vh]" : "max-h-[50vh] md:max-h-[460px]"}`}
          >
            {items.length === 0 ? (
              <div className="px-2 py-3 row-meta">
                <Trans>Waiting for first step…</Trans>
              </div>
            ) : (
              items.map(renderItem)
            )}
          </div>
        </>
      )}

      {isTerminal && workflow.finalMsgid && (
        <>
          <div className="hairline mx-3" />
          <div
            className={`flex items-center gap-2.5 px-3.5 ${isSheet ? "py-3" : "py-2.5"}`}
            style={
              isSheet
                ? {
                    paddingBottom:
                      "calc(0.75rem + var(--safe-area-inset-bottom, 0px))",
                  }
                : undefined
            }
          >
            <button
              type="button"
              className="chip-action"
              disabled={!finalMessageInternalId}
              title={
                finalMessageInternalId
                  ? t`Scroll chat to this response`
                  : t`Response message is no longer in view`
              }
              onClick={() =>
                finalMessageInternalId &&
                scrollToMessageId(finalMessageInternalId)
              }
            >
              <FaArrowRight className="text-[10px]" />
              <Trans>Go to reply</Trans>
            </button>
          </div>
        </>
      )}

      <Menu
        isOpen={!!copyAnchor}
        anchorElement={copyAnchor}
        onClose={() => setCopyAnchor(null)}
        menuItems={[
          {
            id: "json",
            label: t`Copy as JSON`,
            icon: <FaCode />,
            onClick: () =>
              navigator.clipboard?.writeText(workflowToJson(workflow)),
          },
          {
            id: "text",
            label: t`Copy as text`,
            icon: <FaListUl />,
            onClick: () =>
              navigator.clipboard?.writeText(workflowToText(workflow)),
          },
        ]}
      />
      {viewer && (
        <WorkflowOutputViewer
          isOpen
          onClose={() => setViewer(null)}
          title={viewer.title}
          subtitle={`${workflow.senderNick}${workflow.name ? ` · ${workflow.name}` : ""}`}
          content={viewer.content}
        />
      )}
    </div>
  );
};

export default BotToolsCard;
