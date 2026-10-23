import { t } from "@lingui/core/macro";
import type * as React from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FaSoundcloud, FaSpotify, FaVimeoV, FaYoutube } from "react-icons/fa";
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

const ReactPlayer = lazy(() => import("react-player"));

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
  const [audioDuration, setAudioDuration] = useState<number>(Number.NaN);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [audioState, setAudioState] = useState<"loading" | "ready" | "error">(
    "ready",
  );

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

  // Track audio loading state to drive the spinner / error indicator.
  // Reset to "loading" whenever play is requested on a new or fresh URL.
  useEffect(() => {
    if (activeMedia?.type !== "audio" || !activeMedia.isPlaying) return;

    const audio = getAudio();
    // Audio is already playing this URL — skip loading state
    if (
      !audio.paused &&
      audio.src.endsWith(activeMedia.url.replace(/^.*\/\/[^/]+/, ""))
    ) {
      setAudioState("ready");
      return;
    }

    setAudioState("loading");

    const onReady = () => setAudioState("ready");
    const onError = () => setAudioState("error");

    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("playing", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });

    return () => {
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("error", onError);
    };
  }, [activeMedia?.type, activeMedia?.url, activeMedia?.isPlaying]);

  // Track playback position and duration for the seek slider.
  // Uses durationchange because duration can update after initial metadata load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to reset stale position when URL changes
  useEffect(() => {
    if (activeMedia?.type !== "audio") {
      setAudioDuration(Number.NaN);
      setAudioCurrentTime(0);
      return;
    }
    const audio = getAudio();
    const onDuration = () => setAudioDuration(audio.duration);
    const onTime = () => setAudioCurrentTime(audio.currentTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("timeupdate", onTime);
    setAudioDuration(audio.duration);
    setAudioCurrentTime(audio.currentTime);
    return () => {
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("timeupdate", onTime);
    };
  }, [activeMedia?.type, activeMedia?.url]);

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

  if (activeMedia === null || openedMedia !== null) return null;

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
  const isAudioLoading =
    type === "audio" && isPlaying && audioState === "loading";
  const isAudioError = type === "audio" && audioState === "error";
  // Per the HTML5 media spec, live/unbounded streams report duration === Infinity.
  const isAudioLive =
    type === "audio" && audioDuration === Number.POSITIVE_INFINITY;

  return (
    <div className="h-12 flex items-center gap-3 px-3 shrink-0 border-b border-discord-dark-400 bg-discord-dark-300 animate-in slide-in-from-top-2 duration-200">
      {type === "audio" && (
        <>
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
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </button>

          <span
            className={`text-xs truncate shrink-0 max-w-[8rem] transition-colors ${isAudioError ? "text-red-400" : "text-discord-text-normal"}`}
          >
            {filename || "audio"}
          </span>

          {/* Loading state grouped with play-pause so they render as one cohesive element */}
          {isAudioLoading ? (
            // Single loading element: spinner + label in the flex-1 zone, no play button
            <output
              aria-label={t`Connecting`}
              className="flex-1 flex items-center gap-2 min-w-0 text-discord-text-muted"
            >
              <svg
                className="w-3.5 h-3.5 animate-spin shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeOpacity="0.25"
                />
                <path
                  d="M12 3a9 9 0 0 1 9 9"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-xs truncate">Connecting…</span>
            </output>
          ) : isAudioError ? (
            <>
              <span className="flex-1 text-xs text-red-400/80 min-w-0 truncate">
                Failed to load
              </span>
              <div
                className="p-1 text-red-400 shrink-0"
                title={t`Failed to load audio`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  />
                </svg>
              </div>
            </>
          ) : (
            <>
              {isAudioLive ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-[11px] font-semibold tracking-widest text-red-400 uppercase">
                    Live
                  </span>
                </div>
              ) : Number.isFinite(audioDuration) && audioDuration > 0 ? (
                <input
                  type="range"
                  className="flex-1 h-1 cursor-pointer min-w-0 accent-white"
                  min={0}
                  max={audioDuration}
                  step={0.1}
                  value={audioCurrentTime}
                  aria-label={t`Audio position`}
                  onChange={(e) => {
                    getAudio().currentTime = Number(e.target.value);
                  }}
                />
              ) : (
                <div className="flex-1" />
              )}
              <button
                type="button"
                aria-label={isPlaying ? t`Pause` : t`Play`}
                className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-normal shrink-0"
                onClick={() =>
                  isPlaying ? pauseActiveMedia() : playMedia(url, "audio")
                }
              >
                {isPlaying ? (
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </>
          )}

          <CloseButton onClick={stopActiveMedia} />
        </>
      )}
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
                  <ReactPlayer
                    src={url}
                    playing={isPlaying}
                    controls={false}
                    width="1px"
                    height="1px"
                    onPlay={() =>
                      playMedia(
                        url,
                        "embed",
                        getEmbedThumbnailUrl(url) ?? undefined,
                        activeMedia.msgid,
                        activeMedia.serverId,
                        activeMedia.channelId,
                      )
                    }
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
