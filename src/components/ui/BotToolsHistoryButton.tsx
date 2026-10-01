import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { FaCaretDown, FaCaretRight, FaProjectDiagram } from "react-icons/fa";
import {
  countableSteps,
  effectiveWorkflowState,
  isStale,
} from "../../lib/botTools";
import type { AiWorkflow } from "../../store";
import useStore from "../../store";
import Popover from "./Popover";
import WorkflowStatusBadge from "./WorkflowStatusBadge";

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
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [workflows]);

  const activeTotal = useMemo(
    () => workflows.filter(isActive).length,
    [workflows],
  );

  const [open, setOpen] = useState(false);
  const [foldedBots, setFoldedBots] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleBot = (nick: string) =>
    setFoldedBots((folded) => {
      const next = new Set(folded);
      if (!next.delete(nick)) next.add(nick);
      return next;
    });
  const triggerRef = useRef<HTMLButtonElement>(null);

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
        onClose={() => setOpen(false)}
        anchor={triggerRef.current}
        width={320}
        title={<Trans>Workflow history</Trans>}
        titleAdornment={
          <span className="tabular-nums">{workflows.length}</span>
        }
        bodyClassName="max-h-[60vh] md:max-h-none"
      >
        <div className="surface-list">
          {byBot.map(({ nick, list }) => (
            <section key={nick}>
              <button
                type="button"
                onClick={() => toggleBot(nick)}
                aria-expanded={!foldedBots.has(nick)}
                className="section-label normal-case tracking-normal w-full flex items-center gap-1.5 rounded hover:text-white"
              >
                {foldedBots.has(nick) ? <FaCaretRight /> : <FaCaretDown />}
                <span className="truncate">{nick}</span>
                <span className="font-normal tabular-nums">{list.length}</span>
              </button>
              <ul hidden={foldedBots.has(nick)}>
                {list.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => {
                        reopen(w.serverId, w.id);
                        setOpen(false);
                      }}
                      className="row-interactive"
                      title={w.prompt}
                    >
                      <WorkflowStatusBadge
                        state={effectiveWorkflowState(w)}
                        className="w-5 h-5 text-[9px]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate">
                            {w.name ?? t`Workflow`}
                          </span>
                          <span className="row-meta shrink-0 ml-auto tabular-nums">
                            {fmtAgo(w.startedAt)}
                          </span>
                        </span>
                        <span className="row-meta block truncate">
                          {w.prompt ||
                            plural(countableSteps(w.steps), {
                              one: "# step",
                              other: "# steps",
                            })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Popover>
    </>
  );
};

export default BotToolsHistoryButton;
