import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import {
  FaCheck,
  FaChevronRight,
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
import Popover from "./Popover";

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

// Header control listing each bot's workflows for the active channel. The inline
// spinner marks in-flight runs so activity shows without auto-popping cards.
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

  // Sorted latest-first so the submenu reads newest-to-oldest.
  const byBot = useMemo(() => {
    const map = new Map<string, AiWorkflow[]>();
    for (const w of workflows) {
      const key = w.senderNick;
      const list = map.get(key) ?? [];
      list.push(w);
      map.set(key, list);
    }
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setOpen(false);
    setExpandedBot(null);
  };

  if (workflows.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`flex items-center gap-1 p-2 md:p-0 ${
          activeTotal > 0
            ? "text-blue-500 animate-pulse-bright"
            : "hover:text-discord-text-normal"
        }`}
        onClick={() => setOpen((o) => !o)}
        title={
          activeTotal > 0
            ? t`Workflow history (${workflows.length}, ${activeTotal} active)`
            : t`Workflow history (${workflows.length})`
        }
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <FaProjectDiagram />
        <span className="text-[11px] tabular-nums leading-none">
          {workflows.length}
        </span>
      </button>
      <Popover
        isOpen={open}
        onClose={closeMenu}
        anchor={triggerRef.current}
        width={320}
        title={<Trans>Workflow history</Trans>}
        titleAdornment={
          <span className="tabular-nums">{workflows.length}</span>
        }
        bodyClassName="max-h-[60vh] md:max-h-none"
      >
        <ul className="divide-y divide-discord-dark-400/60">
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
                  <span className="w-4 h-4 flex items-center justify-center shrink-0">
                    <FaProjectDiagram
                      className={`text-[10px] ${
                        activeCount > 0
                          ? "text-blue-500 animate-pulse-bright"
                          : "text-discord-text-muted"
                      }`}
                    />
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
                  <FaChevronRight
                    className={`text-discord-text-muted text-[10px] transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {isExpanded && (
                  <ul className="bg-discord-dark-200/60 border-t border-discord-dark-400/60">
                    {list.map((w) => (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => {
                            reopen(w.serverId, w.id);
                            closeMenu();
                          }}
                          className="w-full flex items-start gap-2.5 pl-9 pr-3 py-2.5 md:py-2 text-left hover:bg-discord-dark-400/60 transition-colors"
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
      </Popover>
    </>
  );
};

export default BotToolsHistoryButton;
