import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaCheck,
  FaProjectDiagram,
  FaSpinner,
  FaTimesCircle,
} from "react-icons/fa";
import {
  countableSteps,
  effectiveWorkflowState,
  isStale,
} from "../../lib/botTools";
import type { AiWorkflow } from "../../store";
import useStore from "../../store";
import LoadingSpinner from "./LoadingSpinner";

interface BotToolsHistoryButtonProps {
  serverId: string;
  channel: string | null;
}

const ACTIVE_STATES: ReadonlySet<AiWorkflow["state"]> = new Set([
  "start",
  "reasoning",
  "running",
]);

function isActive(w: AiWorkflow): boolean {
  if (isStale(w)) return false;
  return ACTIVE_STATES.has(w.state);
}

function stateGlyph(state: AiWorkflow["state"]) {
  switch (state) {
    case "complete":
      return <FaCheck className="text-green-400 text-[10px]" />;
    case "failed":
    case "cancelled":
      return <FaTimesCircle className="text-red-400 text-[10px]" />;
    default:
      return (
        <FaSpinner className="text-discord-text-muted text-[10px] animate-spin" />
      );
  }
}

function fmtAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Workflow history button + popover for the chat header.
//
// Now two-level: top tier lists the bots that have run a workflow in
// the active channel (most-recently-active first); hovering or clicking
// a bot opens a second tier of that bot's workflows, latest-first.
// When at least one workflow is in flight the icon carries the shared
// LoadingSpinner badge so the user can see something is happening
// without the tray of cards we used to pop up automatically.
export const BotToolsHistoryButton: React.FC<BotToolsHistoryButtonProps> = ({
  serverId,
  channel,
}) => {
  const { t } = useLingui();
  const reopen = useStore((s) => s.aiWorkflowReopen);
  const serverWorkflows = useStore((s) => s.aiWorkflows[serverId]);

  const workflows = useMemo(() => {
    if (!serverWorkflows || !channel) return [];
    return Object.values(serverWorkflows)
      .filter((w) => w.channel === channel)
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [serverWorkflows, channel]);

  // Group by sender nick.  Each bucket sorted latest-first so the
  // submenu reads top -> bottom newest-to-oldest, matching the rest
  // of the chat surface.
  const byBot = useMemo(() => {
    const map = new Map<string, AiWorkflow[]>();
    for (const w of workflows) {
      const key = w.senderNick;
      const list = map.get(key) ?? [];
      list.push(w);
      map.set(key, list);
    }
    // Sort the bots by their latest workflow's start time.
    return Array.from(map.entries())
      .map(([nick, list]) => ({
        nick,
        list,
        latestAt: list[0]?.startedAt ?? 0,
        activeCount: list.filter(isActive).length,
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [workflows]);

  const activeTotal = useMemo(
    () => workflows.filter(isActive).length,
    [workflows],
  );

  const [open, setOpen] = useState(false);
  const [expandedBot, setExpandedBot] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setExpandedBot(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (workflows.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="hidden md:flex items-center gap-1 hover:text-discord-text-normal relative"
        onClick={() => setOpen((o) => !o)}
        title={
          activeTotal > 0
            ? t`Workflow history (${workflows.length}, ${activeTotal} active)`
            : t`Workflow history (${workflows.length})`
        }
        aria-expanded={open}
      >
        <FaProjectDiagram />
        <span className="text-[11px] tabular-nums leading-none">
          {workflows.length}
        </span>
        {activeTotal > 0 && (
          <span
            className="absolute -top-1.5 -right-2 inline-flex"
            aria-hidden="true"
          >
            <LoadingSpinner size="sm" text="" />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-80 max-w-[90vw] bg-discord-dark-300 border border-discord-dark-400 rounded-lg shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-discord-dark-400 text-xs uppercase tracking-wide text-discord-text-muted flex items-center justify-between">
            <span>
              <Trans>Workflow history</Trans>
            </span>
            <span>{workflows.length}</span>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-discord-dark-400/60">
            {byBot.map(({ nick, list, activeCount }) => {
              const isExpanded = expandedBot === nick;
              return (
                <li key={nick}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBot((prev) => (prev === nick ? null : nick))
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-discord-dark-400/60 transition-colors"
                    aria-expanded={isExpanded}
                  >
                    <span className="mt-0.5 w-4 h-4 flex items-center justify-center shrink-0">
                      {activeCount > 0 ? (
                        <LoadingSpinner size="sm" text="" />
                      ) : (
                        <FaProjectDiagram className="text-discord-text-muted text-[10px]" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold text-white truncate">
                          {nick}
                        </span>
                        <span className="text-[10px] text-discord-text-muted shrink-0">
                          {fmtAgo(list[0].startedAt)}
                        </span>
                      </div>
                      <div className="text-[10px] text-discord-text-muted">
                        <Trans>{list.length} workflow(s)</Trans>
                        {activeCount > 0 && (
                          <span>
                            {" · "}
                            <Trans>{activeCount} active</Trans>
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-discord-text-muted text-xs transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                  </button>
                  {isExpanded && (
                    <ul className="bg-discord-dark-200/60 border-t border-discord-dark-400/60">
                      {list.map((w) => (
                        <li key={w.id}>
                          <button
                            type="button"
                            onClick={() => {
                              reopen(w.serverId, w.id);
                              setOpen(false);
                            }}
                            className="w-full flex items-start gap-2.5 pl-9 pr-3 py-2 text-left hover:bg-discord-dark-400/60 transition-colors"
                          >
                            <span className="mt-0.5 w-4 h-4 flex items-center justify-center shrink-0">
                              {stateGlyph(effectiveWorkflowState(w))}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-xs font-medium text-discord-text-normal truncate">
                                  {w.name ?? t`Workflow`}
                                </span>
                                <span className="text-[10px] text-discord-text-muted shrink-0">
                                  {fmtAgo(w.startedAt)}
                                </span>
                              </div>
                              <div className="text-[10px] text-discord-text-muted">
                                <Trans>{countableSteps(w.steps)} step(s)</Trans>
                                {(() => {
                                  const eff = effectiveWorkflowState(w);
                                  if (eff === "running" || eff === "start")
                                    return null;
                                  let label: string;
                                  if (isStale(w)) label = t`timed out`;
                                  else if (eff === "complete")
                                    label = t`complete`;
                                  else if (eff === "failed") label = t`failed`;
                                  else if (eff === "cancelled")
                                    label = t`cancelled`;
                                  else label = eff;
                                  return (
                                    <span>
                                      {" · "}
                                      {label}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BotToolsHistoryButton;
