import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { FaCompress, FaExpand } from "react-icons/fa";
import { LuPictureInPicture2 } from "react-icons/lu";
import { useSpeakingOrder } from "../../hooks/useSpeakingOrder";
import type { VoiceMember } from "../../lib/voice";
import { ParticipantTile } from "./ParticipantTile";
import { pickPipMember } from "./pickPipMember";
import { onPipRequest, pipSupported } from "./VideoTrackView";

const CONTROLS_HIDE_MS = 4000;

const OVERLAY_BUTTON =
  "flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-black/55 text-white";

export interface VoiceVideoBandProps {
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
  status: React.ReactNode;
  actions: React.ReactNode;
  dock: React.ReactNode;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** The phone layout of a call with video: the main video with the other
 *  people as a strip, and one layer of controls over it that a tap shows and
 *  that hides again after a few seconds so the picture stays clear. It fills
 *  a 16:9 band above the chat, or the whole screen. */
export function VoiceVideoBand({
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
  status,
  actions,
  dock,
  isFullscreen,
  onToggleFullscreen,
}: VoiceVideoBandProps) {
  const ordered = useSpeakingOrder(members);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [interactionCount, setInteractionCount] = useState(0);
  const mainTileRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: every tap restarts the hide timer
  useEffect(() => {
    if (!areControlsVisible) return;
    const timer = setTimeout(
      () => setAreControlsVisible(false),
      CONTROLS_HIDE_MS,
    );
    return () => clearTimeout(timer);
  }, [areControlsVisible, interactionCount]);

  const main =
    ordered.find((m) => m.nick === focusNick) ??
    pickPipMember(ordered, selfNick, focusNick);
  if (!main) return null;
  const others = ordered.filter((m) => m.nick !== main.nick);

  const showControls = () => {
    setAreControlsVisible(true);
    setInteractionCount((n) => n + 1);
  };
  const tileReactions = (nick: string) =>
    reactions
      .filter((r) => r.nick === nick)
      .map((r) => ({ id: r.id, emoji: r.emoji }));
  const requestPip = () =>
    void onPipRequest(
      mainTileRef.current?.querySelector<HTMLVideoElement>(
        "video[data-call-video]",
      ) ?? null,
    );

  return (
    <div
      className={`relative w-full bg-black overflow-hidden ${
        isFullscreen ? "h-full" : "aspect-video"
      }`}
    >
      <div ref={mainTileRef} className="absolute inset-0">
        <ParticipantTile
          member={main}
          serverId={serverId}
          isSelf={main.nick === selfNick}
          onClick={() =>
            areControlsVisible ? setAreControlsVisible(false) : showControls()
          }
          onSetMuted={onSetMuted}
          onSetVolume={onSetVolume}
          reactions={tileReactions(main.nick)}
          mainTile
          bare
        />
      </div>
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70 transition-opacity duration-200 ${
          areControlsVisible ? "opacity-100" : "opacity-0"
        }`}
        onFocusCapture={showControls}
      >
        <div
          className={`absolute top-2 inset-x-2 flex items-center gap-2 ${
            areControlsVisible ? "pointer-events-auto" : ""
          }`}
          onPointerDown={showControls}
        >
          {status}
          <span className="min-w-0 truncate px-2 py-1 rounded-full bg-black/55 text-xs text-white">
            {main.nick}
          </span>
          <span className="flex-1" />
          {actions}
          {pipSupported() && main.videoTrack && (
            <button
              type="button"
              onClick={requestPip}
              title={t`Pop out video`}
              aria-label={t`Pop out video`}
              className={OVERLAY_BUTTON}
            >
              <LuPictureInPicture2 />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? t`Exit full screen` : t`Watch full screen`}
            aria-label={
              isFullscreen ? t`Exit full screen` : t`Watch full screen`
            }
            className={OVERLAY_BUTTON}
          >
            {isFullscreen ? <FaCompress /> : <FaExpand />}
          </button>
        </div>
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col gap-2 px-2 pb-2 ${
            areControlsVisible ? "pointer-events-auto" : ""
          }`}
          onPointerDown={showControls}
        >
          {others.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {others.map((m) => (
                <div key={m.nick} className="h-14 aspect-video flex-shrink-0">
                  <ParticipantTile
                    member={m}
                    serverId={serverId}
                    isSelf={m.nick === selfNick}
                    onClick={() => onFocus(m.nick)}
                    onSetMuted={onSetMuted}
                    onSetVolume={onSetVolume}
                    reactions={tileReactions(m.nick)}
                    canDemote={isHost && m.nick !== selfNick}
                    onDemote={onDemote}
                    compact
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-center">{dock}</div>
        </div>
      </div>
    </div>
  );
}

export default VoiceVideoBand;
