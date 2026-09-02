import type React from "react";
import { useMemo } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import useStore from "../../store";
import { BotToolsCard } from "./BotToolsCard";

interface BotToolsTrayProps {
  serverId: string | null;
  channel: string | null;
}

// Renders only cards the user explicitly reopened (live workflows are surfaced
// in the header instead). Docks to a bottom sheet on touch so a wide card never
// covers the chat or spills off-screen.
export const BotToolsTray: React.FC<BotToolsTrayProps> = ({
  serverId,
  channel,
}) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
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

  const cards = visible.map((w) => (
    <div key={w.id} className="pointer-events-auto">
      <BotToolsCard workflow={w} />
    </div>
  ));

  if (isMobile) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 px-2 pt-2 max-h-[70vh] overflow-y-auto"
        style={{
          paddingBottom: "calc(var(--safe-area-inset-bottom, 0px) + 0.5rem)",
        }}
      >
        {cards}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute top-2 right-2 z-30 flex flex-col gap-2 w-[680px] max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] overflow-y-auto">
      {cards}
    </div>
  );
};

export default BotToolsTray;
