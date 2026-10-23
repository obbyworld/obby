import { t } from "@lingui/core/macro";
import { useRef } from "react";
import {
  FaCircle,
  FaCompress,
  FaExpand,
  FaHandPaper,
  FaMicrophoneSlash,
  FaUserMinus,
  FaVolumeMute,
  FaVolumeUp,
} from "react-icons/fa";
import { LuPictureInPicture2 } from "react-icons/lu";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useUserColor } from "../../hooks/useUserColor";
import type { VoiceMember } from "../../lib/voice";
import { onPipRequest, pipSupported, VideoTrackView } from "./VideoTrackView";
import { VoiceAvatar } from "./voiceAvatar";

export interface ParticipantTileProps {
  member: VoiceMember;
  isSelf: boolean;
  onClick: () => void;
  onSetMuted: (nick: string, muted: boolean) => void;
  onSetVolume: (nick: string, volume: number) => void;
  reactions: Array<{ id: number; emoji: string }>;
  canDemote?: boolean;
  onDemote?: (nick: string) => void;
  /** Filmstrip thumbnails are too narrow for the volume slider to stay usable. */
  compact?: boolean;
  serverId?: string;
  theater?: boolean;
  /** Only the stage's single or spotlighted tile gets a maximize button. */
  onToggleTheater?: () => void;
  /** The tile the user is actually watching (single tile, spotlight),
   *  as opposed to a small grid or filmstrip thumbnail -- letterboxes
   *  its video instead of cropping it. */
  mainTile?: boolean;
  /** The phone band draws its own controls over the tile, so the tile shows
   *  only the video. */
  bare?: boolean;
}

const CONTROL_BUTTON =
  "flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-white hover:bg-white/10";

/** One tile on the stage or in the pop-out's filmstrip. Fills its
 *  container -- callers control aspect ratio and sizing. */
export function ParticipantTile({
  member,
  isSelf,
  onClick,
  onSetMuted,
  onSetVolume,
  reactions,
  canDemote,
  onDemote,
  compact,
  serverId,
  theater,
  onToggleTheater,
  mainTile,
  bare,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nickColor = useUserColor(serverId, member.nick);
  const isTouch = useIsTouchInput();

  // Small grid and filmstrip tiles stay cropped -- a mosaic reads better
  // that way -- but once theater mode enlarges the grid, every tile is
  // something the user is watching, not a thumbnail, so it letterboxes too.
  const contain =
    member.screenSharing || mainTile || (Boolean(theater) && !compact);
  const speaking = member.speaking && member.micOn;
  const muted = member.volume === 0;
  const showPip = pipSupported() && !!member.videoTrack;
  const qualityLabel =
    member.quality === "good"
      ? t`Connection: good`
      : member.quality === "ok"
        ? t`Connection: fair`
        : t`Connection: poor`;

  // The bar itself only reveals on interaction; the nick label is a
  // separate, always-on sibling so you can still tell who a tile is
  // while the controls are hidden.
  const barVisibilityClass = isTouch
    ? ""
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  const sliderWidthClass = isTouch
    ? "w-20 ml-1"
    : "w-0 group-hover/vol:w-20 group-hover/vol:ml-1 focus-within:w-20 focus-within:ml-1";

  return (
    <div
      className={`group relative w-full h-full overflow-hidden ${
        bare
          ? "bg-black"
          : `bg-discord-dark-300 rounded-xl ${
              speaking
                ? "ring-2 ring-discord-green ring-inset"
                : "ring-1 ring-discord-dark-200"
            }`
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={member.nick}
        className="absolute inset-0 flex items-center justify-center"
      >
        {member.videoTrack ? (
          <VideoTrackView
            ref={videoRef}
            track={member.videoTrack}
            muted={isSelf}
            contain={contain}
            className="w-full h-full"
          />
        ) : (
          <VoiceAvatar nick={member.nick} size="lg" serverId={serverId} />
        )}
      </button>

      {member.handRaised && (
        <div className="pointer-events-none absolute top-1 left-1 px-1.5 py-1 rounded bg-yellow-500/90 text-white text-xs">
          <FaHandPaper />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {reactions.map((r, i) => (
          <span
            key={r.id}
            className="absolute text-3xl animate-react-float"
            style={{ left: `${30 + ((i * 17) % 40)}%`, bottom: "20%" }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {member.quality !== "unknown" && !isSelf && !bare && (
        <span
          className="pointer-events-none absolute top-1 right-1 z-10"
          title={qualityLabel}
        >
          <FaCircle
            className={
              member.quality === "good"
                ? "text-discord-green"
                : member.quality === "ok"
                  ? "text-yellow-400"
                  : "text-discord-red"
            }
            style={{ fontSize: 8 }}
          />
        </span>
      )}

      {!bare && (
        <div className="absolute inset-x-0 bottom-0 z-10">
          <div
            className={`flex items-center gap-1 px-1.5 py-1.5 bg-gradient-to-t from-black/70 to-transparent transition-opacity ${barVisibilityClass}`}
          >
            <span className="flex-1" />
            {!isSelf && (
              <span className="group/vol flex items-center flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onSetMuted(member.nick, !muted)}
                  title={muted ? t`Unmute for me` : t`Mute for me`}
                  aria-label={muted ? t`Unmute for me` : t`Mute for me`}
                  className={CONTROL_BUTTON}
                >
                  {muted ? (
                    <FaVolumeMute className="text-discord-red" />
                  ) : (
                    <FaVolumeUp />
                  )}
                </button>
                {!compact && (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={member.volume}
                    onChange={(e) =>
                      onSetVolume(member.nick, Number(e.target.value))
                    }
                    aria-label={t`Volume for ${member.nick}`}
                    className={`h-1 rounded-full accent-white cursor-pointer overflow-hidden transition-[width] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${sliderWidthClass}`}
                  />
                )}
              </span>
            )}
            {!isSelf && canDemote && onDemote && (
              <button
                type="button"
                onClick={() => onDemote(member.nick)}
                title={t`Demote to viewer`}
                aria-label={t`Demote to viewer`}
                className={`${CONTROL_BUTTON} text-discord-red`}
              >
                <FaUserMinus />
              </button>
            )}
            {showPip && (
              <button
                type="button"
                onClick={() => void onPipRequest(videoRef.current)}
                title={t`Pop out video`}
                aria-label={t`Pop out video`}
                className={CONTROL_BUTTON}
              >
                <LuPictureInPicture2 />
              </button>
            )}
            {onToggleTheater && (
              <button
                type="button"
                onClick={onToggleTheater}
                title={theater ? t`Collapse` : t`Expand`}
                aria-label={theater ? t`Collapse` : t`Expand`}
                className={CONTROL_BUTTON}
              >
                {theater ? <FaCompress /> : <FaExpand />}
              </button>
            )}
          </div>

          <div className="absolute left-1.5 bottom-1.5 max-w-[75%] flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-white text-xs">
            <span
              className="truncate min-w-0"
              style={nickColor ? { color: nickColor } : undefined}
            >
              {member.nick}
            </span>
            {!member.micOn && (
              <FaMicrophoneSlash className="text-discord-red flex-shrink-0" />
            )}
            {member.deafened && (
              <FaVolumeMute className="text-discord-red flex-shrink-0" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ParticipantTile;
