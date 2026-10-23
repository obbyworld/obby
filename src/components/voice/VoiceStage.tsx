import { useEffect, useState } from "react";
import { useSpeakingOrder } from "../../hooks/useSpeakingOrder";
import type { VoiceMember } from "../../lib/voice";
import { ParticipantTile } from "./ParticipantTile";
import { VoiceAvatar } from "./voiceAvatar";

export interface VoiceStageProps {
  members: VoiceMember[];
  serverId: string;
  selfNick: string;
  focusNick: string | null;
  onFocus: (nick: string | null) => void;
  reactions: Array<{ id: number; nick: string; emoji: string }>;
  onSetMuted: (nick: string, muted: boolean) => void;
  onSetVolume: (nick: string, volume: number) => void;
  isHost: boolean;
  onDemote: (nick: string) => void;
  theater: boolean;
  onToggleTheater: () => void;
}

const GRID_COLUMN_BREAKPOINTS: Array<[maxWidth: number, columns: number]> = [
  [420, 1],
  [700, 2],
  [1000, 3],
];

const VISIBLE_TILE_CAP_INLINE = 6;
const VISIBLE_TILE_CAP_THEATER = 12;

function gridColumnsFor(width: number): number {
  for (const [maxWidth, columns] of GRID_COLUMN_BREAKPOINTS) {
    if (width < maxWidth) return columns;
  }
  return 4;
}

/** Lays itself out from what is being shown, not from a fixed grid: one
 *  tile alone, a spotlight (explicit click or auto screen-share) with a
 *  filmstrip, or a responsive grid sized to the panel's own width rather
 *  than the viewport. Every tile stays aspect-video in inline mode so it
 *  never collapses to zero height; theater mode drops the aspect ratio
 *  and fills the available space instead. Past the grid's visible cap,
 *  the rest render as a small avatar strip -- members are always
 *  ordered by useSpeakingOrder first, so a member who starts talking
 *  sorts back into the visible set on its own. */
export function VoiceStage({
  members,
  serverId,
  selfNick,
  focusNick,
  onFocus,
  reactions,
  onSetMuted,
  onSetVolume,
  isHost,
  onDemote,
  theater,
  onToggleTheater,
}: VoiceStageProps) {
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [gridColumns, setGridColumns] = useState(4);
  const ordered = useSpeakingOrder(members);

  useEffect(() => {
    if (!gridEl) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = gridColumnsFor(entry.contentRect.width);
      setGridColumns((prev) => (next === prev ? prev : next));
    });
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl]);

  if (ordered.length === 0) return null;

  const renderTile = (
    m: VoiceMember,
    opts?: {
      spotlighted?: boolean;
      compact?: boolean;
      clickable?: boolean;
      main?: boolean;
    },
  ) => (
    <ParticipantTile
      key={m.nick}
      member={m}
      serverId={serverId}
      isSelf={m.nick === selfNick}
      onClick={
        opts?.clickable === false
          ? () => {}
          : () => onFocus(opts?.spotlighted ? null : m.nick)
      }
      onSetMuted={onSetMuted}
      onSetVolume={onSetVolume}
      reactions={reactions
        .filter((r) => r.nick === m.nick)
        .map((r) => ({ id: r.id, emoji: r.emoji }))}
      canDemote={isHost && m.nick !== selfNick}
      onDemote={onDemote}
      compact={opts?.compact}
      theater={theater}
      onToggleTheater={opts?.main ? onToggleTheater : undefined}
      mainTile={opts?.main}
    />
  );

  // A single streamer already fills the stage, so clicking it would set
  // focus state with nothing visibly different -- keep the tile inert.
  if (ordered.length === 1) {
    return (
      <div
        className={
          theater
            ? "flex-1 min-h-0 flex items-center justify-center p-3"
            : "p-3"
        }
      >
        <div
          className={
            theater
              ? "w-full h-full max-w-6xl mx-auto"
              : "aspect-video max-h-[40vh] w-full max-w-4xl mx-auto"
          }
        >
          {renderTile(ordered[0], { clickable: false, main: true })}
        </div>
      </div>
    );
  }

  const spotlightNick =
    focusNick ?? ordered.find((m) => m.screenSharing)?.nick ?? null;
  const spotlight = spotlightNick
    ? ordered.find((m) => m.nick === spotlightNick)
    : undefined;

  if (spotlight) {
    const others = ordered.filter((m) => m.nick !== spotlight.nick);
    return (
      <div
        className={
          theater
            ? "flex-1 min-h-0 flex flex-col gap-3 p-3"
            : "flex flex-col gap-3 p-3"
        }
      >
        <div
          className={
            theater ? "flex-1 min-h-0" : "aspect-video max-h-[40vh] w-full"
          }
        >
          {renderTile(spotlight, { spotlighted: true, main: true })}
        </div>
        {others.length > 0 && (
          <div className="flex gap-2 overflow-x-auto flex-shrink-0 h-24 md:h-28">
            {others.map((m) => (
              <div key={m.nick} className="aspect-video h-full flex-shrink-0">
                {renderTile(m, { compact: true })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const cap = theater ? VISIBLE_TILE_CAP_THEATER : VISIBLE_TILE_CAP_INLINE;
  const visible = ordered.slice(0, cap);
  const overflow = ordered.slice(cap);

  return (
    <div className={theater ? "flex-1 min-h-0 flex flex-col" : "flex flex-col"}>
      <div
        ref={setGridEl}
        className={`grid gap-3 p-3 ${theater ? "flex-1 min-h-0 auto-rows-fr" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((m) => (
          <div key={m.nick} className={theater ? "h-full" : "aspect-video"}>
            {renderTile(m)}
          </div>
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3 flex-shrink-0">
          {overflow.map((m) => (
            <VoiceAvatar
              key={m.nick}
              nick={m.nick}
              size="sm"
              serverId={serverId}
              className={
                m.speaking && m.micOn ? "ring-2 ring-discord-green" : ""
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default VoiceStage;
