import { useSpeakingOrder } from "../../hooks/useSpeakingOrder";
import type { VoiceMember } from "../../lib/voice";
import { VoiceAvatar } from "./voiceAvatar";

const VISIBLE_AVATARS = 5;

export interface VoiceAvatarBarProps {
  members: VoiceMember[];
  serverId: string;
  dock: React.ReactNode;
}

/** The phone layout of a call without video: a slim bar of who is in the call,
 *  whoever is talking ringed, with the dock under it, so chat keeps the rest of
 *  the screen. */
export function VoiceAvatarBar({
  members,
  serverId,
  dock,
}: VoiceAvatarBarProps) {
  const ordered = useSpeakingOrder(members);
  const visible = ordered.slice(0, VISIBLE_AVATARS);
  const hiddenCount = ordered.length - visible.length;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 bg-discord-dark-300/60">
      <div className="flex items-center gap-3 overflow-x-auto">
        {visible.map((m) => (
          <div
            key={m.nick}
            className="flex flex-col items-center gap-1 w-12 flex-shrink-0"
          >
            <VoiceAvatar
              nick={m.nick}
              size="sm"
              serverId={serverId}
              className={
                m.speaking && m.micOn ? "ring-2 ring-discord-green" : ""
              }
            />
            <span className="max-w-full truncate text-[10px] text-discord-text-muted">
              {m.nick}
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <span className="flex-shrink-0 w-8 h-8 rounded-full border border-discord-dark-500 flex items-center justify-center text-xs text-discord-text-normal">
            +{hiddenCount}
          </span>
        )}
      </div>
      <div className="flex justify-center">{dock}</div>
    </div>
  );
}

export default VoiceAvatarBar;
