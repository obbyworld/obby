import { t } from "@lingui/core/macro";
import { useRef } from "react";
import {
  FaCircle,
  FaHandPaper,
  FaMicrophoneSlash,
  FaUserMinus,
  FaVolumeMute,
  FaVolumeUp,
} from "react-icons/fa";
import { LuPictureInPicture2 } from "react-icons/lu";
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
}

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
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nickColor = useUserColor(serverId, member.nick);

  const speaking = member.speaking && member.micOn;
  const muted = member.volume === 0;
  const showPip = pipSupported() && !!member.videoTrack;
  const qualityLabel =
    member.quality === "good"
      ? t`Connection: good`
      : member.quality === "ok"
        ? t`Connection: fair`
        : t`Connection: poor`;

  return (
    <div
      className={`group relative w-full h-full bg-discord-dark-300 rounded-xl overflow-hidden ${
        speaking
          ? "ring-2 ring-discord-green ring-inset"
          : "ring-1 ring-discord-dark-200"
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
            contain={member.screenSharing}
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

      <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
        {member.quality !== "unknown" && !isSelf && (
          <span className="pointer-events-none" title={qualityLabel}>
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
        {showPip && (
          <button
            type="button"
            onClick={() => void onPipRequest(videoRef.current)}
            title={t`Pop out video`}
            aria-label={t`Pop out video`}
            className="w-6 h-6 rounded bg-black/50 text-white flex items-center justify-center text-xs hover:bg-black/70"
          >
            <LuPictureInPicture2 />
          </button>
        )}
      </div>

      <div className="absolute bottom-1 left-1 right-1 z-10 px-2 py-0.5 rounded bg-black/50 backdrop-blur-sm text-white text-xs flex items-center gap-1.5">
        <span
          className="truncate min-w-0 flex-1"
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
        {!isSelf && (
          <>
            <button
              type="button"
              onClick={() => onSetMuted(member.nick, !muted)}
              title={muted ? t`Unmute for me` : t`Mute for me`}
              aria-label={muted ? t`Unmute for me` : t`Mute for me`}
              className="flex-shrink-0 hover:text-discord-primary"
            >
              {muted ? <FaVolumeUp /> : <FaVolumeMute />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={member.volume}
              onChange={(e) => onSetVolume(member.nick, Number(e.target.value))}
              aria-label={t`Volume for ${member.nick}`}
              className={`accent-discord-primary flex-shrink-0 ${compact ? "hidden" : "w-20"}`}
            />
            {canDemote && onDemote && (
              <button
                type="button"
                onClick={() => onDemote(member.nick)}
                title={t`Demote to viewer`}
                aria-label={t`Demote to viewer`}
                className="flex-shrink-0 text-discord-red hover:text-discord-red/70"
              >
                <FaUserMinus />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ParticipantTile;
