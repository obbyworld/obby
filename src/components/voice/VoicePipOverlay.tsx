// Floating pop-out card for a live voice/stream call the user has
// navigated away from. Lets a call survive channel switches, settings,
// and DMs instead of dying with its view -- see src/lib/voice.ts.

import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import {
  FaExternalLinkAlt,
  FaMicrophone,
  FaMicrophoneSlash,
  FaPhoneSlash,
} from "react-icons/fa";
import { LuPictureInPicture2 } from "react-icons/lu";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSpeakingOrder } from "../../hooks/useSpeakingOrder";
import { useUserColor } from "../../hooks/useUserColor";
import { useLiveVoiceCalls, useVoiceCall } from "../../hooks/useVoiceCall";
import { releaseVoiceClient } from "../../lib/voice";
import { useSpotlight } from "../../lib/voiceSpotlight";
import useStore from "../../store";
import { DockButton } from "./DockButton";
import { pickPipMember } from "./pickPipMember";
import { onPipRequest, pipSupported, VideoTrackView } from "./VideoTrackView";
import { VoiceAvatar } from "./voiceAvatar";

const MAX_PIP_THUMBNAILS = 3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

interface DragPosition {
  left: number;
  top: number;
}

/** Renders the pop-out for whichever live call, if any, isn't the
 *  channel currently on screen. */
export const VoicePipOverlay: React.FC = () => {
  const calls = useLiveVoiceCalls();
  const selectedServerId = useStore((s) => s.ui.selectedServerId);
  const selectedChannelName = useStore((s) => {
    const sel = s.ui.perServerSelections[s.ui.selectedServerId || ""];
    if (!sel?.selectedChannelId) return null;
    const srv = s.servers.find((x) => x.id === s.ui.selectedServerId);
    return (
      srv?.channels.find((c) => c.id === sel.selectedChannelId)?.name ?? null
    );
  });

  const call = calls.find(
    (c) =>
      !(c.serverId === selectedServerId && c.channel === selectedChannelName),
  );

  if (!call) return null;

  return (
    <VoicePipCard
      key={`${call.serverId}:${call.channel}`}
      serverId={call.serverId}
      channel={call.channel}
    />
  );
};

const VoicePipCard: React.FC<{ serverId: string; channel: string }> = ({
  serverId,
  channel,
}) => {
  const { t } = useLingui();
  const isNarrow = useMediaQuery();
  const { client, members, selfNick, self, isStreamRoom, streamerMembers } =
    useVoiceCall(serverId, channel);
  // A stream has one streamer and any number of viewers with no media of
  // their own -- a viewer watching shouldn't see their own tile among the
  // thumbnails. A voice call has no such distinction, so it keeps showing
  // everyone including the local user.
  const pipMembers = isStreamRoom ? streamerMembers : members;
  const selectServer = useStore((s) => s.selectServer);
  const selectChannel = useStore((s) => s.selectChannel);
  const channelId = useStore((s) => {
    const srv = s.servers.find((x) => x.id === serverId);
    return srv?.channels.find((c) => c.name === channel)?.id ?? null;
  });

  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const [pos, setPos] = useState<DragPosition | null>(null);

  const ordered = useSpeakingOrder(pipMembers);
  const [spotlightNick, setSpotlightNick] = useSpotlight(serverId, channel);
  const primary = pickPipMember(ordered, selfNick, spotlightNick);
  const isSelf = primary?.nick === selfNick;
  const hasAnyVideo = ordered.some((m) => m.videoTrack);
  const primaryColor = useUserColor(serverId, primary?.nick);
  const rest = primary ? ordered.filter((m) => m.nick !== primary.nick) : [];
  const thumbs = rest.slice(0, MAX_PIP_THUMBNAILS);
  const overflowCount = rest.length - MAX_PIP_THUMBNAILS;

  const returnToChannel = useCallback(() => {
    if (!channelId) return;
    selectServer(serverId);
    selectChannel(channelId, { navigate: true });
  }, [channelId, selectServer, selectChannel, serverId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const card = cardRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !card) return;
    const left = clamp(
      drag.startLeft + (e.clientX - drag.startX),
      0,
      window.innerWidth - card.offsetWidth,
    );
    const top = clamp(
      drag.startTop + (e.clientY - drag.startY),
      0,
      window.innerHeight - card.offsetHeight,
    );
    setPos({ left, top });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }, []);

  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="fixed z-[9000] w-44 sm:w-64 rounded-xl overflow-hidden bg-discord-dark-400 ring-1 ring-black/40 shadow-2xl select-none touch-none"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : { right: 12, bottom: isNarrow ? 96 : 24 }
      }
    >
      <div className="flex items-center gap-1 px-2 py-1 bg-discord-dark-300">
        <span className="flex-1 min-w-0 truncate text-xs text-discord-text-normal">
          {channel}
        </span>
        {pipSupported() && !!primary?.videoTrack && (
          <DockButton
            icon={<LuPictureInPicture2 />}
            size="sm"
            label={t`Picture-in-picture`}
            onClick={() => onPipRequest(videoRef.current)}
          />
        )}
        <DockButton
          icon={<FaExternalLinkAlt />}
          size="sm"
          label={t`Return to channel`}
          onClick={returnToChannel}
        />
      </div>

      {hasAnyVideo ? (
        <>
          <button
            type="button"
            onClick={returnToChannel}
            aria-label={t`Return to channel`}
            className={`relative w-full aspect-video bg-black flex items-center justify-center ${
              primary?.speaking && primary?.micOn
                ? "ring-2 ring-discord-green ring-inset"
                : ""
            }`}
          >
            {primary?.videoTrack ? (
              <VideoTrackView
                ref={videoRef}
                track={primary.videoTrack}
                muted={isSelf}
                contain
                className="w-full h-full"
              />
            ) : (
              primary && (
                <VoiceAvatar
                  nick={primary.nick}
                  size="lg"
                  serverId={serverId}
                />
              )
            )}
            {primary && (
              <span
                className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-xs truncate text-left"
                style={primaryColor ? { color: primaryColor } : undefined}
              >
                {primary.nick}
              </span>
            )}
          </button>
          {(thumbs.length > 0 || overflowCount > 0) && (
            <div className="flex gap-1 px-2 pt-1 pb-2 bg-discord-dark-300">
              {thumbs.map((m) => (
                <button
                  key={m.nick}
                  type="button"
                  onClick={() => setSpotlightNick(m.nick)}
                  aria-label={m.nick}
                  className={`relative flex-1 min-w-0 aspect-video rounded overflow-hidden bg-black flex items-center justify-center ${
                    m.speaking && m.micOn
                      ? "ring-2 ring-discord-green ring-inset"
                      : ""
                  }`}
                >
                  {m.videoTrack ? (
                    <VideoTrackView
                      track={m.videoTrack}
                      muted
                      contain={m.screenSharing}
                      className="w-full h-full"
                    />
                  ) : (
                    <VoiceAvatar nick={m.nick} size="sm" serverId={serverId} />
                  )}
                </button>
              ))}
              {overflowCount > 0 && (
                <div className="flex-1 min-w-0 aspect-video rounded bg-discord-dark-200 flex items-center justify-center text-xs text-discord-text-muted">
                  +{overflowCount}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={returnToChannel}
          aria-label={t`Return to channel`}
          className="w-full flex flex-wrap gap-2 justify-center p-3 bg-discord-dark-400"
        >
          {ordered.map((m) => (
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
        </button>
      )}

      <div className="flex items-center justify-center gap-2 px-2 py-2 bg-discord-dark-300">
        <DockButton
          icon={self?.micOn ? <FaMicrophone /> : <FaMicrophoneSlash />}
          state={self?.micOn ? "neutral" : "off"}
          size="sm"
          label={self?.micOn ? t`Mute` : t`Unmute`}
          onClick={() => client?.setMic(!self?.micOn)}
        />
        <DockButton
          icon={<FaPhoneSlash />}
          state="danger"
          size="sm"
          label={t`Leave call`}
          onClick={() => releaseVoiceClient(serverId, channel)}
        />
      </div>
    </div>
  );
};
