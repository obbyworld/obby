import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowRight,
  FaChevronDown,
  FaChevronUp,
  FaCode,
  FaListUl,
  FaRegCopy,
  FaStop,
  FaTimes,
} from "react-icons/fa";
import { useNow } from "../../hooks/useNow";
import { isScrolledToBottom } from "../../hooks/useScrollToBottom";
import {
  countableSteps,
  effectiveWorkflowState,
  groupWorkflowSteps,
  isStale,
  isStepGroupRunning,
  isTerminalState,
  type StepGroup,
  stepGroupState,
} from "../../lib/botTools";
import { copyToClipboard } from "../../lib/clipboard";
import {
  formatDuration,
  type StepContent,
  workflowToJson,
  workflowToText,
} from "../../lib/workflowFormat";
import type { AiWorkflow } from "../../store";
import useStore from "../../store";
import Menu from "./Menu";
import WorkflowOutputViewer from "./WorkflowOutputViewer";
import WorkflowStatusBadge from "./WorkflowStatusBadge";
import WorkflowStepRow, { type WorkflowAction } from "./WorkflowStepRow";

interface BotToolsCardProps {
  workflow: AiWorkflow;
  // "sheet" docks the card to the bottom of a touch screen.
  variant?: "floating" | "sheet";
}

const FADE_SECONDS = 5;

const isOpenByDefault = (group: StepGroup): boolean =>
  isStepGroupRunning(group) ||
  stepGroupState(group) === "failed" ||
  stepGroupState(group) === "pending-approval";

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

  // The 1s tick re-renders a live card, and effectiveWorkflowState reads the
  // clock, so a stuck run flips to "timed out" on its own.
  const isTerminal = isTerminalState(effectiveWorkflowState(workflow));
  const now = useNow(!isTerminal);
  const displayState = effectiveWorkflowState(workflow, now);
  const isSheet = variant === "sheet";

  // biome-ignore lint/correctness/useExhaustiveDependencies: step content updates keep the array reference, so we watch updatedAt
  const groups = useMemo(
    () => groupWorkflowSteps(workflow.steps),
    [workflow.steps, workflow.updatedAt],
  );
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const isGroupOpen = (group: StepGroup) =>
    openKeys[group.key] ?? isOpenByDefault(group);

  const [copyAnchor, setCopyAnchor] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<{
    content: StepContent;
    title: string;
  } | null>(null);
  const openViewer = useCallback(
    (content: StepContent, title: string) => setViewer({ content, title }),
    [],
  );

  const sendWorkflowAction = (action: WorkflowAction, target: string) =>
    sendAction(workflow.serverId, workflow.senderNick, {
      msg: "action",
      action,
      target,
    });

  const hasPendingApproval = workflow.steps.some(
    (s) => s.state === "pending-approval",
  );
  const elapsed = formatDuration(
    (isTerminal ? workflow.updatedAt : now) - workflow.startedAt,
  );

  // A finished, collapsed card fades out; hovering it pauses the countdown.
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
    if (el) isStickyToBottom.current = isScrolledToBottom(el, 24);
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
  const iconButton = isSheet ? "icon-button w-11 h-11" : "icon-button";

  const statusLine = isTerminal ? (
    <>
      {plural(countableSteps(workflow.steps), {
        one: "# step",
        other: "# steps",
      })}
      {` · ${elapsed}`}
    </>
  ) : hasPendingApproval ? (
    <span className="text-amber-400">
      <Trans>approve to continue</Trans>
    </span>
  ) : (
    <span className="text-blue-400">
      <Trans>running · {elapsed}</Trans>
    </span>
  );

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
        <WorkflowStatusBadge
          state={displayState}
          isTimedOut={isStale(workflow, now)}
        />
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
          {workflow.prompt && !isSheet && (
            <span className="row-meta truncate">{workflow.prompt}</span>
          )}
        </div>
        {workflow.collapsed && hasPendingApproval && (
          <span className="self-center shrink-0 text-[11px] font-semibold text-discord-dark-400 bg-amber-400 rounded-full px-2 py-px">
            <Trans>approve to continue</Trans>
          </span>
        )}
        {!isTerminal && (
          <button
            type="button"
            onClick={() => sendWorkflowAction("cancel", workflow.id)}
            className={`${isSheet ? "h-11 px-3" : "h-7 px-2.5"} rounded flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:bg-red-600 hover:text-white`}
          >
            <FaStop className="text-[9px]" />
            <Trans>Stop</Trans>
          </button>
        )}
        <button
          type="button"
          className={iconButton}
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
          className={iconButton}
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
          className={iconButton}
          onClick={() => dismiss(workflow.serverId, workflow.id)}
          aria-label={t`Close workflow`}
          title={t`Close workflow`}
        >
          <FaTimes className="text-xs" />
        </button>
      </div>
      {workflow.prompt && isSheet && (
        <p className="row-meta px-3.5 pb-2.5 line-clamp-2">{workflow.prompt}</p>
      )}

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
            {groups.length === 0 ? (
              <div className="px-2 py-3 row-meta">
                <Trans>Waiting for first step…</Trans>
              </div>
            ) : (
              groups.map((group) => (
                <WorkflowStepRow
                  key={group.key}
                  group={group}
                  now={now}
                  isOpen={isGroupOpen(group)}
                  isSheet={isSheet}
                  onToggle={() =>
                    setOpenKeys((keys) => ({
                      ...keys,
                      [group.key]: !isGroupOpen(group),
                    }))
                  }
                  onOpenViewer={openViewer}
                  onSendAction={sendWorkflowAction}
                />
              ))
            )}
          </div>
        </>
      )}

      {isTerminal && workflow.finalMsgid && (
        <>
          <div className="hairline mx-3" />
          <div
            className={`flex items-center gap-2.5 px-3.5 ${isSheet ? "py-3" : "py-2.5"}`}
          >
            <button
              type="button"
              className={`chip-action ${isSheet ? "min-h-11" : ""}`}
              disabled={!finalMessageInternalId}
              title={
                finalMessageInternalId
                  ? t`Scroll chat to this response`
                  : t`Load older messages to reach the reply`
              }
              onClick={() =>
                finalMessageInternalId &&
                useStore.getState().revealMessage(finalMessageInternalId)
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
            onClick: () => copyToClipboard(workflowToJson(workflow)),
          },
          {
            id: "text",
            label: t`Copy as text`,
            icon: <FaListUl />,
            onClick: () => copyToClipboard(workflowToText(workflow)),
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
