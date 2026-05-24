import type React from "react";
import { useMemo } from "react";
import useStore from "../../store";
import { AiToolsCard } from "./AiToolsCard";

interface AiToolsTrayProps {
  serverId: string | null;
  // Channel name or PM target the user is currently viewing. Workflows
  // are scoped to their announce-channel so we only show what's relevant
  // to the user's current focus.
  channel: string | null;
}

export const AiToolsTray: React.FC<AiToolsTrayProps> = ({
  serverId,
  channel,
}) => {
  const serverWorkflows = useStore((s) =>
    serverId ? s.aiWorkflows[serverId] : undefined,
  );

  const visible = useMemo(() => {
    if (!serverWorkflows || !channel) return [];
    return (
      Object.values(serverWorkflows)
        // Skip historical workflows -- those replay through CHATHISTORY
        // when joining a channel and shouldn't pop a wall of cards.
        // They still appear in the history popover for inspection.
        .filter((w) => !w.dismissed && !w.historical && w.channel === channel)
        .sort((a, b) => b.startedAt - a.startedAt)
    );
  }, [serverWorkflows, channel]);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-30 flex flex-col gap-2 max-h-[calc(100%-2rem)] overflow-y-auto">
      {visible.map((w) => (
        <div key={w.id} className="pointer-events-auto">
          <AiToolsCard workflow={w} />
        </div>
      ))}
    </div>
  );
};

export default AiToolsTray;
