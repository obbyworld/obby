import { t } from "@lingui/core/macro";
import type React from "react";
import { lazy, useEffect, useRef, useState } from "react";
import { getAppYouTubeEmbedUrl } from "../../lib/mediaUtils";

const ReactPlayer = lazy(() => import("react-player"));

interface EmbedPlayerProps {
  url: string;
  /** Undefined leaves the player to the user's own clicks. */
  playing?: boolean;
  controls?: boolean;
  /** Seconds to resume from, for a player taking over from another. */
  startAt?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: () => void;
  onTime?: (seconds: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

// Every YouTube/Vimeo/Spotify embed in the app plays through this, so the
// inline preview, the mini player and the media viewer behave the same on
// every platform, including the iOS/macOS loopback YouTube page.
export const EmbedPlayer: React.FC<EmbedPlayerProps> = (props) => {
  const [loopbackSrc] = useState(() =>
    getAppYouTubeEmbedUrl(props.url, props.startAt),
  );
  return loopbackSrc ? (
    <LoopbackYouTubePlayer {...props} src={loopbackSrc} />
  ) : (
    <ReactPlayerEmbed {...props} />
  );
};

const ReactPlayerEmbed: React.FC<EmbedPlayerProps> = ({
  url,
  playing,
  controls = true,
  startAt,
  onPlay,
  onPause,
  onEnded,
  onError,
  onTime,
  style,
}) => {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const startAtRef = useRef(startAt);
  const [config] = useState(() => ({
    youtube: { disablekb: 1 as const, start: Math.floor(startAt ?? 0) },
    vimeo: { keyboard: false },
  }));
  return (
    <ReactPlayer
      ref={playerRef}
      src={url}
      width="100%"
      height="100%"
      controls={controls}
      playing={playing}
      config={config}
      style={{ borderRadius: "4px", overflow: "hidden", ...style }}
      onLoadedMetadata={() => {
        const resumeAt = startAtRef.current;
        if (!resumeAt || !playerRef.current) return;
        startAtRef.current = undefined;
        playerRef.current.currentTime = resumeAt;
      }}
      onTimeUpdate={() => {
        const time = playerRef.current?.currentTime;
        if (time !== undefined) onTime?.(time);
      }}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onEnded}
      onError={onError}
    />
  );
};

type BridgeMessage = {
  source: "obby-yt";
  type: "ready" | "play" | "pause" | "ended" | "error" | "time";
  time?: number;
};

const sendCommand = (iframe: HTMLIFrameElement | null, cmd: "play" | "pause") =>
  iframe?.contentWindow?.postMessage({ source: "obby-yt-cmd", cmd }, "*");

const LoopbackYouTubePlayer: React.FC<EmbedPlayerProps & { src: string }> = ({
  src,
  playing,
  onPlay,
  onPause,
  onEnded,
  onError,
  onTime,
  className,
  style,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlersRef = useRef({ onPlay, onPause, onEnded, onError, onTime });
  handlersRef.current = { onPlay, onPause, onEnded, onError, onTime };
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const onMessage = (event: MessageEvent<BridgeMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.source !== "obby-yt") return;
      const handlers = handlersRef.current;
      switch (event.data.type) {
        case "ready":
          if (playingRef.current) sendCommand(iframeRef.current, "play");
          break;
        case "play":
          handlers.onPlay?.();
          break;
        case "pause":
          handlers.onPause?.();
          break;
        case "ended":
          handlers.onEnded?.();
          break;
        case "error":
          handlers.onError?.();
          break;
        case "time":
          if (event.data.time !== undefined) handlers.onTime?.(event.data.time);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (playing !== undefined)
      sendCommand(iframeRef.current, playing ? "play" : "pause");
  }, [playing]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={t`YouTube video player`}
      className={className ?? "h-full w-full rounded"}
      style={style}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
    />
  );
};

export default EmbedPlayer;
