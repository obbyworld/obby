import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaCheck,
  FaProjectDiagram,
  FaSpinner,
  FaTimesCircle,
} from "react-icons/fa";
import { countableSteps } from "../../lib/aiTools";
import type { AiWorkflow } from "../../store";
import useStore from "../../store";

interface AiToolsHistoryButtonProps {
  serverId: string;
  channel: string | null;
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

// Workflow history button + popover for the chat header. Renders nothing
// when no workflows exist for the current target -- so the icon doesn't
// take up space until there's something to surface.
export const AiToolsHistoryButton: React.FC<AiToolsHistoryButtonProps> = ({
  serverId,
  channel,
}) => {
  const { t } = useLingui();
  const reopen = useStore((s) => s.aiWorkflowReopen);
  const serverWorkflows = useStore((s) => s.aiWorkflows[serverId]);

  // All workflows for this server filtered to the current target.
  // Newest-first so the most-relevant ones are at the top of the list.
  const workflows = useMemo(() => {
    if (!serverWorkflows || !channel) return [];
    return Object.values(serverWorkflows)
      .filter((w) => w.channel === channel)
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [serverWorkflows, channel]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
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
        className="hidden md:flex items-center gap-1 hover:text-discord-text-normal"
        onClick={() => setOpen((o) => !o)}
        title={t`Workflow history (${workflows.length})`}
        aria-expanded={open}
      >
        <FaProjectDiagram />
        <span className="text-[11px] tabular-nums leading-none">
          {workflows.length}
        </span>
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
            {workflows.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    reopen(w.serverId, w.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-discord-dark-400/60 transition-colors"
                >
                  <span className="mt-0.5 w-4 h-4 flex items-center justify-center shrink-0">
                    {stateGlyph(w.state)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-semibold text-white truncate">
                        {w.senderNick}
                      </span>
                      <span className="text-[10px] text-discord-text-muted shrink-0">
                        {fmtAgo(w.startedAt)}
                      </span>
                    </div>
                    {w.name && (
                      <div className="text-xs text-discord-text-muted truncate">
                        {w.name}
                      </div>
                    )}
                    <div className="text-[10px] text-discord-text-muted mt-0.5">
                      <Trans>{countableSteps(w.steps)} step(s)</Trans>
                      {w.state !== "running" && w.state !== "start" && (
                        <span> · {w.state}</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AiToolsHistoryButton;
