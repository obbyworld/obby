import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  FaExclamationTriangle,
  FaMusic,
  FaPause,
  FaPlay,
  FaSoundcloud,
  FaSpinner,
  FaSpotify,
  FaTimes,
  FaVimeoV,
  FaYoutube,
} from "react-icons/fa";
import { getAudio } from "../../lib/audioManager";
import {
  filenameFromUrl,
  getEmbedFallbackLabel,
  getEmbedThumbnailUrl,
} from "../../lib/mediaUtils";
import {
  getVideoPosition,
  setVideoPosition,
} from "../../lib/videoPositionCache";
import useStore from "../../store";
import { MediaErrorBoundary } from "../MediaErrorBoundary";
import { EmbedPlayer } from "../message/EmbedPlayer";

const CloseButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    aria-label={t`Stop`}
    className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-muted hover:text-discord-text-normal transition-colors shrink-0"
    onClick={onClick}
  >
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  </button>
);

export const MiniMediaPlayer: React.FC = () => {
  const activeMedia = useStore((state) => state.ui.activeMedia);
  const openedMedia = useStore((state) => state.ui.openedMedia);
  const playMedia = useStore((state) => state.playMedia);
  const pauseActiveMedia = useStore((state) => state.pauseActiveMedia);
  const stopActiveMedia = useStore((state) => state.stopActiveMedia);
  const openMedia = useStore((state) => state.openMedia);

  const [embedTitle, setEmbedTitle] = useState<string | undefined>(undefined);

  // Fetch oEmbed title when an embed becomes active
  useEffect(() => {
    if (activeMedia?.type !== "embed") {
      setEmbedTitle(undefined);
      return;
    }
    const embedUrl = activeMedia.url;
    let oEmbedEndpoint: string | null = null;
    try {
      const host = new URL(embedUrl).hostname.replace(/^www\./, "");
      if (host === "youtube.com" || host === "youtu.be") {
        oEmbedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(embedUrl)}&format=json`;
      } else if (host === "vimeo.com") {
        oEmbedEndpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(embedUrl)}`;
      } else if (host === "open.spotify.com") {
        oEmbedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(embedUrl)}`;
      }
    } catch {
      // ignore invalid URLs
    }
    if (!oEmbedEndpoint) return;

    const controller = new AbortController();
    fetch(oEmbedEndpoint, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.title === "string") setEmbedTitle(data.title);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeMedia?.url, activeMedia?.type]);

  // No cleanup pause — audio must survive MiniMediaPlayer remounts on resize.
  useEffect(() => {
    const audio = getAudio();
    if (activeMedia?.type === "audio") {
      if (audio.src !== activeMedia.url) {
        audio.src = activeMedia.url;
      }
      if (activeMedia.isPlaying) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    } else {
      audio.pause();
      audio.src = "";
    }
  }, [activeMedia?.type, activeMedia?.url, activeMedia?.isPlaying]);

  const hiddenVideoRef = useRef<HTMLVideoElement>(null);

  // Drive hidden <video> for channel-switch continuity (mirrors hidden ReactPlayer for embeds).
  // The hidden video is always rendered so the browser keeps it loaded across channel switches.
  // When isInlineVisible=true the VideoPreview element owns playback — keep hidden video paused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to visibility/playing state changes
  useEffect(() => {
    if (activeMedia?.type !== "video") return;
    const video = hiddenVideoRef.current;
    if (!video) return;

    if (activeMedia.isInlineVisible) {
      video.pause();
      return;
    }

    const onLoaded = () => {
      const cached = getVideoPosition(video.src);
      const seekTo = cached ?? activeMedia.currentTime;
      if (seekTo !== undefined && seekTo > 0 && seekTo < video.duration) {
        video.currentTime = seekTo;
      }
      if (activeMedia.isPlaying) {
        video.play().catch(() => {});
      }
    };

    if (video.readyState >= 1) onLoaded();
    else video.addEventListener("loadedmetadata", onLoaded, { once: true });

    const onEnded = () => stopActiveMedia();
    video.addEventListener("ended", onEnded);

    return () => {
      const t = video.currentTime;
      if (t > 0) setVideoPosition(video.src, t);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("ended", onEnded);
    };
  }, [
    activeMedia?.type,
    activeMedia?.isInlineVisible,
    activeMedia?.isPlaying,
    activeMedia?.url,
  ]);

  // Sync play/pause from mini player controls to the hidden video.
  useEffect(() => {
    if (activeMedia?.type !== "video" || activeMedia.isInlineVisible) return;
    const video = hiddenVideoRef.current;
    if (!video || video.readyState < 1) return;
    if (activeMedia.isPlaying) {
      if (video.paused) video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [activeMedia?.type, activeMedia?.isInlineVisible, activeMedia?.isPlaying]);

  if (
    activeMedia === null ||
    openedMedia !== null ||
    activeMedia.type === "audio"
  )
    return null;

  const { url, type, thumbnailUrl, isPlaying, isInlineVisible } = activeMedia;

  const filename = filenameFromUrl(url);

  const embedThumb = type === "embed" ? getEmbedThumbnailUrl(url) : null;

  // Brand icon shown in the icon slot when there's no thumbnail.
  // Communicates the platform at a glance without text prefix.
  const embedPlatformIcon = (() => {
    if (type !== "embed") return null;
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === "open.spotify.com")
        return <FaSpotify className="w-4 h-4 text-[#1DB954]" />;
      if (host === "youtube.com" || host === "youtu.be")
        return <FaYoutube className="w-4 h-4 text-[#FF0000]" />;
      if (host === "vimeo.com")
        return <FaVimeoV className="w-4 h-4 text-[#1AB7EA]" />;
      if (host === "soundcloud.com")
        return <FaSoundcloud className="w-4 h-4 text-[#FF5500]" />;
    } catch {
      // ignore invalid URLs
    }
    return null;
  })();

  return (
    <div className="h-12 flex items-center gap-3 px-3 shrink-0 border-b border-discord-dark-400 bg-discord-dark-300 animate-in slide-in-from-top-2 duration-200">
      {type === "video" && (
        <>
          {/* Hidden <video> — always rendered when a video is active so the browser pre-loads the
              resource and the element survives channel switches without reloading or losing position.
              When isInlineVisible=true the VideoPreview owns playback; the drive effect keeps this paused. */}
          <div
            style={{
              position: "absolute",
              width: "1px",
              height: "1px",
              overflow: "hidden",
              opacity: 0,
              pointerEvents: "none",
            }}
            aria-hidden="true"
          >
            {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded IRC videos have no caption tracks */}
            <video
              ref={hiddenVideoRef}
              src={url}
              preload="metadata"
              playsInline
              style={{ width: "1px", height: "1px" }}
            />
          </div>
          <button
            type="button"
            aria-label={t`Open in viewer`}
            className={
              isInlineVisible
                ? "p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-muted shrink-0"
                : "shrink-0 rounded overflow-hidden hover:opacity-80 transition-opacity"
            }
            onClick={() =>
              openMedia(
                url,
                activeMedia.msgid,
                activeMedia.serverId,
                activeMedia.channelId,
              )
            }
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                className="w-10 h-7 object-cover rounded"
                alt=""
              />
            ) : (
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            )}
          </button>
          <span className="text-xs text-discord-text-normal truncate flex-1">
            {filename || "Now Playing"}
          </span>
          <button
            type="button"
            aria-label={isPlaying ? t`Pause` : t`Play`}
            className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-normal shrink-0"
            onClick={() =>
              isPlaying ? pauseActiveMedia() : playMedia(url, "video")
            }
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <CloseButton onClick={stopActiveMedia} />
        </>
      )}
      {type === "embed" && (
        <>
          {!isInlineVisible && (
            <div
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                overflow: "hidden",
                opacity: 0,
                pointerEvents: "none",
              }}
              aria-hidden="true"
            >
              <Suspense fallback={null}>
                <MediaErrorBoundary onError={stopActiveMedia}>
                  <EmbedPlayer
                    url={url}
                    playing={isPlaying}
                    controls={false}
                    startAt={getVideoPosition(url) ?? activeMedia.currentTime}
                    onTime={(time) => setVideoPosition(url, time)}
                    onPlay={() => {
                      // Loading a provider fires a play event, which must
                      // not start a video the user paused.
                      if (!useStore.getState().ui.activeMedia?.isPlaying)
                        return;
                      playMedia(
                        url,
                        "embed",
                        getEmbedThumbnailUrl(url) ?? undefined,
                        activeMedia.msgid,
                        activeMedia.serverId,
                        activeMedia.channelId,
                      );
                    }}
                    onPause={() => pauseActiveMedia()}
                    onEnded={() => stopActiveMedia()}
                  />
                </MediaErrorBoundary>
              </Suspense>
            </div>
          )}
          {embedThumb ? (
            <button
              type="button"
              aria-label={t`Open in viewer`}
              className="shrink-0 rounded overflow-hidden hover:opacity-80 transition-opacity"
              onClick={() =>
                openMedia(
                  url,
                  activeMedia.msgid,
                  activeMedia.serverId,
                  activeMedia.channelId,
                )
              }
            >
              <img
                src={embedThumb}
                className="w-10 h-7 object-cover block"
                alt=""
              />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t`Open in viewer`}
              className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-muted shrink-0"
              onClick={() =>
                openMedia(
                  url,
                  activeMedia.msgid,
                  activeMedia.serverId,
                  activeMedia.channelId,
                )
              }
            >
              {embedPlatformIcon ?? (
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
              )}
            </button>
          )}
          <span className="text-xs text-discord-text-normal truncate flex-1">
            {embedTitle || getEmbedFallbackLabel(url, !!embedPlatformIcon)}
          </span>
          <button
            type="button"
            aria-label={isPlaying ? t`Pause` : t`Play`}
            className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-normal shrink-0"
            onClick={() =>
              isPlaying ? pauseActiveMedia() : playMedia(url, "embed")
            }
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <CloseButton onClick={stopActiveMedia} />
        </>
      )}
    </div>
  );
};

// Row contents for the active audio track. MiniMediaPlayer keeps driving the
// shared audio element, so this can mount and unmount freely.
export const AudioControls: React.FC<{ buttonClassName: string }> = ({
  buttonClassName,
}) => {
  const activeMedia = useStore((state) => state.ui.activeMedia);
  const playMedia = useStore((state) => state.playMedia);
  const pauseActiveMedia = useStore((state) => state.pauseActiveMedia);
  const stopActiveMedia = useStore((state) => state.stopActiveMedia);
  const openMedia = useStore((state) => state.openMedia);

  const [duration, setDuration] = useState<number>(Number.NaN);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "ready",
  );

  const url = activeMedia?.type === "audio" ? activeMedia.url : null;
  const isPlaying = activeMedia?.isPlaying ?? false;

  useEffect(() => {
    if (!url || !isPlaying) return;
    const audio = getAudio();
    if (!audio.paused && audio.src.endsWith(url.replace(/^.*\/\/[^/]+/, ""))) {
      setLoadState("ready");
      return;
    }
    setLoadState("loading");
    const onReady = () => setLoadState("ready");
    const onError = () => setLoadState("error");
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("playing", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    return () => {
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("error", onError);
    };
  }, [url, isPlaying]);

  // We listen to durationchange because the duration can change after the metadata loads.
  useEffect(() => {
    if (!url) return;
    const audio = getAudio();
    const onDuration = () => setDuration(audio.duration);
    const onTime = () => setCurrentTime(audio.currentTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("timeupdate", onTime);
    setDuration(audio.duration);
    setCurrentTime(audio.currentTime);
    return () => {
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("timeupdate", onTime);
    };
  }, [url]);

  if (!activeMedia || !url) return null;

  const isLoading = isPlaying && loadState === "loading";
  const isError = loadState === "error";
  // Live streams report an infinite duration per the HTML media spec.
  const isLive = duration === Number.POSITIVE_INFINITY;

  return (
    <>
      <button
        type="button"
        aria-label={t`Open in viewer`}
        title={t`Open in viewer`}
        className={buttonClassName}
        onClick={() =>
          openMedia(
            url,
            activeMedia.msgid,
            activeMedia.serverId,
            activeMedia.channelId,
          )
        }
      >
        <FaMusic className="text-xs" />
      </button>
      <span
        className={`min-w-0 max-w-[40%] shrink truncate ${isError ? "text-red-400" : "text-discord-text-normal"}`}
      >
        {filenameFromUrl(url) || t`Audio`}
      </span>
      {isLoading ? (
        <output className="row-meta flex min-w-0 flex-1 items-center gap-1.5">
          <FaSpinner className="shrink-0 animate-spin" />
          <span className="truncate">
            <Trans>Connecting…</Trans>
          </span>
        </output>
      ) : isError ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-red-400">
          <FaExclamationTriangle className="shrink-0" />
          <span className="truncate">
            <Trans>Failed to load</Trans>
          </span>
        </span>
      ) : isLive ? (
        <span className="flex flex-1 items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-red-400">
            <Trans>Live</Trans>
          </span>
        </span>
      ) : Number.isFinite(duration) && duration > 0 ? (
        <input
          type="range"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-discord-primary"
          min={0}
          max={duration}
          step={0.1}
          value={currentTime}
          aria-label={t`Audio position`}
          onChange={(e) => {
            getAudio().currentTime = Number(e.target.value);
          }}
        />
      ) : (
        <span className="flex-1" />
      )}
      {!isLoading && !isError && (
        <button
          type="button"
          aria-label={isPlaying ? t`Pause` : t`Play`}
          title={isPlaying ? t`Pause` : t`Play`}
          className={buttonClassName}
          onClick={() =>
            isPlaying ? pauseActiveMedia() : playMedia(url, "audio")
          }
        >
          {isPlaying ? (
            <FaPause className="text-xs" />
          ) : (
            <FaPlay className="text-xs" />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={t`Stop`}
        title={t`Stop`}
        className={buttonClassName}
        onClick={stopActiveMedia}
      >
        <FaTimes className="text-xs" />
      </button>
    </>
  );
};
