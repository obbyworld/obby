import type React from "react";
import { useMemo } from "react";
import useStore from "../../store";
import { BotToolsCard } from "./BotToolsCard";

interface BotToolsTrayProps {
  serverId: string | null;
  channel: string | null;
}

// Tray now only renders cards the user *explicitly* re-opened from the
// history popover or the "view workflow" affordance next to a finished
// PRIVMSG.  Live workflows no longer auto-pop a card; the chat-header
// workflow icon shows a spinner badge while one is in flight and lets
// the user open the card when they want it.  This keeps the right edge
// of the chat area uncluttered when many bots are working at once.
export const BotToolsTray: React.FC<BotToolsTrayProps> = ({
  serverId,
  channel,
}) => {
  const serverWorkflows = useStore((s) =>
    serverId ? s.aiWorkflows[serverId] : undefined,
  );

  const visible = useMemo(() => {
    if (!serverWorkflows || !channel) return [];
    return Object.values(serverWorkflows)
      .filter(
        (w) => w.userOpened === true && !w.dismissed && w.channel === channel,
      )
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [serverWorkflows, channel]);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-30 flex flex-col gap-2 max-h-[calc(100%-2rem)] overflow-y-auto">
      {visible.map((w) => (
        <div key={w.id} className="pointer-events-auto">
          <BotToolsCard workflow={w} />
        </div>
      ))}
    </div>
  );
};

export default BotToolsTray;
