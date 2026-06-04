import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import exifr from "exifr";
import type * as React from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  FaFileAlt,
  FaPause,
  FaPlay,
  FaSpinner,
  FaVolumeMute,
  FaVolumeUp,
} from "react-icons/fa";
import { getAudio } from "../../lib/audioManager";
import ircClient from "../../lib/ircClient";
import { probeMediaUrl } from "../../lib/mediaProbe";
import {
  canPlayVideoUrl,
  filenameFromUrl,
  getEmbedThumbnailUrl,
  imageCanHaveTransparency,
  type MediaEntry,
  type MediaType,
} from "../../lib/mediaUtils";
import { useMediaController } from "../../lib/useMediaController";
import {
  getVideoPosition,
  setVideoPosition,
} from "../../lib/videoPositionCache";
import useStore from "../../store";

const ReactPlayer = lazy(() => import("react-player"));
const LazyDocument = lazy(() =>
  import("react-pdf").then((m) => {
    // Set here on the lazy path, not at startup, to keep pdfjs out of the main bundle.
    if (m.pdfjs?.GlobalWorkerOptions) {
      m.pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    return { default: m.Document };
  }),
);
const LazyPage = lazy(() =>
  import("react-pdf").then((m) => ({ default: m.Page })),
);

const PDF_THUMB_W = 240;
const PDF_THUMB_H = Math.round(PDF_THUMB_W * Math.SQRT2); // A4 ratio

function extractJpegComment(uint8Array: Uint8Array): string | null {
  if (
    uint8Array.length < 4 ||
    uint8Array[0] !== 0xff ||
    uint8Array[1] !== 0xd8
  ) {
    return null;
  }

  let offset = 2;

  while (offset < uint8Array.length - 1) {
    if (uint8Array[offset] !== 0xff) {
      break;
    }

    const marker = uint8Array[offset + 1];
    const markerLength = (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];

    if (marker === 0xfe) {
      const commentData = uint8Array.slice(
        offset + 4,
        offset + markerLength + 2,
      );
      try {
        return new TextDecoder("utf-8").decode(commentData);
      } catch (e) {
        return String.fromCharCode.apply(null, Array.from(commentData));
      }
    }

    offset += markerLength + 2;

    if (marker === 0xda) {
      break;
    }
  }

  return null;
}

const FilehostImageBanner: React.FC<{
  exifData: { author?: string; jwt_expiry?: string; server_expiry?: string };
  serverId?: string;
  onOpenProfile?: (username: string) => void;
}> = ({ exifData, serverId, onOpenProfile }) => {
  const currentUser = serverId ? ircClient.getCurrentUser(serverId) : null;

  if (!exifData.author) return null;

  const [ircNick, ircAccount] = exifData.author.split(":");
  const isVerified =
    currentUser?.account &&
    ircAccount !== "0" &&
    currentUser.account.toLowerCase() === ircAccount.toLowerCase();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenProfile) {
      onOpenProfile(ircNick);
    }
  };

  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded-b-lg flex items-center cursor-pointer hover:bg-opacity-90 transition-opacity"
      onClick={handleClick}
    >
      <div className="flex items-center gap-1">
        <span>{ircNick}</span>
        {isVerified && (
          <svg
            className="w-3 h-3 text-green-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
    </div>
  );
};

const ImagePreview: React.FC<{
  url: string;
  msgid?: string;
  isFilehostImage?: boolean;
  serverId?: string;
  channelId?: string;
  onOpenProfile?: (username: string) => void;
}> = ({
  url,
  msgid,
  isFilehostImage = false,
  serverId,
  channelId,
  onOpenProfile,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const openMedia = useStore((state) => state.openMedia);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [exifData, setExifData] = useState<{
    author?: string;
    jwt_expiry?: string;
    server_expiry?: string;
  } | null>(null);
  const [exifError, setExifError] = useState(false);

  useEffect(() => {
    const resolveTenorUrl = async (sharingUrl: string) => {
      try {
        const match = sharingUrl.match(/tenor\.com\/view\/.*-gif-(\d+)/);
        if (!match) return sharingUrl;

        const gifId = match[1];
        const apiKey = import.meta.env.VITE_TENOR_API_KEY;

        if (!apiKey) return sharingUrl;

        const response = await fetch(
          `https://tenor.googleapis.com/v2/posts?ids=${gifId}&key=${apiKey}`,
        );

        if (!response.ok) return sharingUrl;

        const data = await response.json();
        if (data.results?.[0]?.media_formats) {
          const media = data.results[0].media_formats;
          return (
            media.gif?.url ||
            media.mediumgif?.url ||
            media.tinygif?.url ||
            sharingUrl
          );
        }
      } catch (error) {
        console.warn("Failed to resolve Tenor URL:", error);
      }
      return sharingUrl;
    };

    const processUrl = async () => {
      let finalUrl = url;

      if (url.match(/tenor\.com\/view\//)) {
        finalUrl = await resolveTenorUrl(url);
        setResolvedUrl(finalUrl);
      } else {
        setResolvedUrl(url);
      }

      if (isFilehostImage) {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();

          const exif = await exifr.parse(blob);

          let commentData = null;
          if (exif?.Comment) {
            commentData = exif.Comment;
          } else if (exif?.UserComment) {
            commentData = exif.UserComment;
          } else if (exif?.ImageDescription) {
            commentData = exif.ImageDescription;
          } else if (exif?.iptc?.Caption) {
            commentData = exif.iptc.Caption;
          } else if (exif?.xmp?.description) {
            commentData = exif.xmp.description;
          }

          if (!commentData) {
            try {
              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);
              commentData = extractJpegComment(uint8Array);
            } catch (error) {
              console.warn("Failed to manually parse JPEG comment:", error);
            }
          }

          if (commentData) {
            try {
              const parsedData = JSON.parse(commentData);
              setExifData({
                author: parsedData.author,
                jwt_expiry: parsedData.jwt_expiry,
                server_expiry: parsedData.server_expiry,
              });
            } catch {
              setExifError(true);
            }
          } else {
            setExifError(true);
          }
        } catch {
          setExifError(true);
        }
      }
    };

    processUrl();
  }, [url, isFilehostImage]);

  const displayUrl = resolvedUrl || url;

  if (imageError) {
    // Filehost images embed a JWT in the URL — expiry is the likely cause.
    // For all other images, return null and let the URL text in the message
    // body serve as the fallback (the probe already confirmed it was an image,
    // so the server likely returned the image but it failed to render — e.g.
    // expired CDN token, corrupted file).
    if (!isFilehostImage) return null;
    return (
      <div className="max-w-md">
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-red-100 text-red-800 border border-red-200">
            <Trans>This image has expired</Trans>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <div className="relative inline-block rounded border border-discord-dark-500/50 overflow-hidden">
        {!imageLoaded && !imageError && (
          <div
            className="flex items-center justify-center bg-discord-dark-400/50"
            style={{ width: "200px", height: "150px" }}
          >
            <FaSpinner className="text-discord-text-muted animate-spin text-lg" />
          </div>
        )}
        <img
          src={displayUrl}
          alt={isFilehostImage ? t`Filehost image` : t`GIF`}
          className={`max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity ${imageCanHaveTransparency(displayUrl) ? "transparency-grid" : "bg-white"} ${imageLoaded ? "block" : "hidden"}`}
          onClick={() => openMedia(displayUrl, msgid, serverId, channelId)}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          style={{ maxHeight: "150px" }}
        />
        {isFilehostImage && exifData && imageLoaded && (
          <FilehostImageBanner
            exifData={exifData}
            serverId={serverId}
            onOpenProfile={onOpenProfile}
          />
        )}
      </div>
    </div>
  );
};

function formatVideoTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const VideoUnsupported: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const openMedia = useStore((s) => s.openMedia);
  return (
    <div className="max-w-md">
      <button
        type="button"
        className="flex items-center gap-2 py-2 px-3 rounded border border-discord-dark-500/50 bg-discord-dark-400/30 text-discord-text-muted text-xs hover:bg-discord-dark-500/40 hover:text-discord-text-normal transition-colors w-full text-left"
        onClick={() => openMedia(url, msgid, serverId, channelId)}
        title={t`Open in viewer`}
      >
        <svg
          className="w-4 h-4 shrink-0"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
        </svg>
        <span className="truncate flex-1">
          {url.split("/").pop()?.split("?")[0] || "video"}
        </span>
        <span className="text-discord-text-muted/60 shrink-0">
          {t`— open in viewer`}
        </span>
      </button>
    </div>
  );
};

const VideoPlayer: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const openMedia = useStore((state) => state.openMedia);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Use refs for seek bar and time display — avoids React re-renders on every timeupdate,
  // which stalls WKWebView's video compositing layer.
  const seekRef = useRef<HTMLInputElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const thumbnailCapturedRef = useRef(false);

  const { isActive, isPlaying, play, pause } = useMediaController({
    url,
    type: "video",
    msgid,
    serverId,
    channelId,
    inlineVisibility: {
      getPosition: () => {
        const t = videoRef.current?.currentTime;
        if (t !== undefined && t > 0) setVideoPosition(url, t);
        return t;
      },
    },
    onExternalStop: () => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.currentTime = 0;
      if (seekRef.current) seekRef.current.value = "0";
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00";
    },
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isActive) return;
    if (isPlaying) {
      if (video.paused) video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isActive, isPlaying]);

  // Kill the zombie mini-player: when a runtime error fires while this video is
  // active (e.g. unsupported VP9 profile at decode time despite canPlayType passing),
  // clear the store immediately so the mini bar disappears instead of hanging empty.
  useEffect(() => {
    if (loadError && isActive) useStore.getState().stopActiveMedia();
  }, [loadError, isActive]);

  // Native event listeners for timeupdate/loadedmetadata/ended — more reliable in
  // WKWebView than React synthetic events, which can be silently dropped.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (timeDisplayRef.current && !timeDisplayRef.current.textContent)
      timeDisplayRef.current.textContent = "0:00";

    const onTimeUpdate = () => {
      const t = video.currentTime;
      if (seekRef.current) seekRef.current.value = String(t);
      if (timeDisplayRef.current)
        timeDisplayRef.current.textContent = formatVideoTime(t);
    };

    const onLoadedMetadata = () => {
      const d = video.duration ?? 0;
      setDuration(d);
      if (seekRef.current) seekRef.current.max = String(d);
      // Restore position after channel-switch or scroll-back via videoPositionCache.
      const saved = getVideoPosition(url);
      if (saved !== undefined && saved > 0 && saved < d) {
        video.currentTime = saved;
        if (seekRef.current) seekRef.current.value = String(saved);
        if (timeDisplayRef.current)
          timeDisplayRef.current.textContent = formatVideoTime(saved);
      }
    };

    const onEnded = () => useStore.getState().pauseActiveMedia();
    const onError = () => setLoadError(true);

    // Capture thumbnail via a separate CORS-enabled element so the main player
    // is never affected by crossOrigin restrictions. Falls back silently if the
    // server doesn't support CORS.
    thumbnailCapturedRef.current = false;
    let thumbVideo: HTMLVideoElement | null = document.createElement("video");
    thumbVideo.crossOrigin = "anonymous";
    thumbVideo.preload = "auto";
    thumbVideo.muted = true;
    thumbVideo.src = url;
    const releaseThumbVideo = () => {
      if (thumbVideo) {
        thumbVideo.src = "";
        thumbVideo = null;
      }
    };
    thumbVideo.addEventListener(
      "loadeddata",
      () => {
        if (!thumbVideo || thumbVideo.videoWidth === 0) {
          releaseThumbVideo();
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = thumbVideo.videoWidth;
        canvas.height = thumbVideo.videoHeight;
        const ctx = canvas.getContext("2d");
        try {
          if (ctx && !thumbnailCapturedRef.current) {
            ctx.drawImage(thumbVideo, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            setThumbnail(dataUrl);
            thumbnailCapturedRef.current = true;
            // Push thumbnail to store so MiniMediaPlayer bar can show it.
            // Guard by URL — store action is a no-op if different video is active.
            useStore.getState().setActiveMediaThumbnail(url, dataUrl);
          }
        } catch {
          // CORS or security error — no thumbnail for this URL
        }
        releaseThumbVideo();
      },
      { once: true },
    );
    thumbVideo.addEventListener("error", releaseThumbVideo, { once: true });

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    // `loadedmetadata` may have already fired before this effect runs.
    if (video.readyState >= 1) onLoadedMetadata();
    return () => {
      releaseThumbVideo();
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      setThumbnail(null);
    };
  }, [url]);

  function handlePlayPause() {
    if (isPlaying) {
      videoRef.current?.pause();
      pause();
    } else {
      // Call play() synchronously here — WKWebView requires video.play() to be called
      // within the user gesture handler for unmuted audio-containing media.
      // Calling it from useEffect (async, post-render) loses the gesture context.
      videoRef.current?.play().catch(() => {});
      useStore
        .getState()
        .playMedia(
          url,
          "video",
          thumbnail ?? undefined,
          msgid,
          serverId,
          channelId,
        );
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    if (timeDisplayRef.current)
      timeDisplayRef.current.textContent = formatVideoTime(t);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
  }

  function handleToggleMute() {
    const next = volume === 0 ? 1 : 0;
    setVolume(next);
    if (videoRef.current) videoRef.current.volume = next;
  }

  if (loadError) {
    return (
      <VideoUnsupported
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  }

  return (
    <div ref={containerRef} className="max-w-md">
      <div className="relative inline-block rounded-lg overflow-hidden bg-black shadow-lg group">
        {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded IRC videos have no caption tracks */}
        <video
          ref={videoRef}
          src={url}
          preload="metadata"
          playsInline
          style={{ maxHeight: "360px", maxWidth: "100%", display: "block" }}
          className="cursor-pointer"
          onClick={handlePlayPause}
        />
        {thumbnail && !isPlaying && (
          <img
            src={thumbnail}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
        )}
        {!isPlaying && (
          <button
            type="button"
            aria-label={t`Play`}
            onClick={handlePlayPause}
            className="absolute inset-0 flex items-center justify-center z-10"
          >
            <div className="bg-black/50 backdrop-blur-sm rounded-full p-5 text-white hover:scale-110 hover:bg-black/70 transition-all duration-150 shadow-xl">
              <FaPlay className="w-7 h-7 ml-0.5" />
            </div>
          </button>
        )}
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pt-8 pb-2 px-3 transition-opacity duration-200 ${
            isPlaying
              ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
              : "opacity-100"
          }`}
        >
          <div className="flex items-center gap-2 text-white">
            <button
              type="button"
              aria-label={isPlaying ? t`Pause` : t`Play`}
              className="shrink-0 hover:scale-110 transition-transform"
              onClick={handlePlayPause}
            >
              {isPlaying ? (
                <FaPause className="w-3.5 h-3.5" />
              ) : (
                <FaPlay className="w-3.5 h-3.5" />
              )}
            </button>
            <span
              ref={timeDisplayRef}
              className="text-xs tabular-nums shrink-0 text-white/75"
            />
            <input
              ref={seekRef}
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.1}
              defaultValue={0}
              onChange={handleSeek}
              className="flex-1 h-0.5 accent-white cursor-pointer rounded-full"
              aria-label={t`Seek`}
            />
            <span className="text-xs tabular-nums shrink-0 text-white/40">
              {formatVideoTime(duration)}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                aria-label={volume === 0 ? t`Unmute` : t`Mute`}
                className="shrink-0 hover:scale-110 transition-transform text-white/75 hover:text-white"
                onClick={handleToggleMute}
              >
                {volume === 0 ? (
                  <FaVolumeMute className="w-3.5 h-3.5" />
                ) : (
                  <FaVolumeUp className="w-3.5 h-3.5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={handleVolumeChange}
                className="w-14 h-0.5 accent-white cursor-pointer"
                aria-label={t`Volume`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Thin router: check codec support before rendering the player.
// Keeps VideoPlayer free of conditional hooks.
const VideoPreview: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  // canPlayVideoUrl() is a synchronous HTMLVideoElement.canPlayType() probe — no
  // network request. Skipping the player entirely prevents the zombie mini-player
  // (play → store active → codec error → mini-bar playing nothing).
  if (!canPlayVideoUrl(url)) {
    return (
      <VideoUnsupported
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  }
  return (
    <VideoPlayer
      url={url}
      msgid={msgid}
      serverId={serverId}
      channelId={channelId}
    />
  );
};

const AudioPreview: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const { isActive, isPlaying, play, pause, stop } = useMediaController({
    url,
    type: "audio",
    msgid,
    serverId,
    channelId,
  });
  const [isLive, setIsLive] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: url resets live state when switching streams
  useEffect(() => {
    if (!isActive) {
      setIsLive(false);
      return;
    }
    const audio = getAudio();
    const onDuration = () =>
      setIsLive(audio.duration === Number.POSITIVE_INFINITY);
    audio.addEventListener("durationchange", onDuration);
    setIsLive(audio.duration === Number.POSITIVE_INFINITY);
    return () => audio.removeEventListener("durationchange", onDuration);
  }, [isActive, url]);

  const filename = filenameFromUrl(url);

  return (
    <div className="mt-2 max-w-sm flex items-center gap-2 py-2 px-3 rounded border border-discord-dark-500/50 bg-discord-dark-400/30">
      <svg
        className="w-4 h-4 text-discord-text-muted shrink-0"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
      <span className="text-xs text-discord-text-muted truncate flex-1">
        {filename || "audio"}
      </span>
      {isActive && isLive && (
        <div className="flex items-center gap-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-semibold tracking-widest text-red-400 uppercase">
            Live
          </span>
        </div>
      )}
      {isActive ? (
        <>
          <button
            type="button"
            aria-label={isPlaying ? t`Pause` : t`Play`}
            className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-normal"
            onClick={() => (isPlaying ? pause() : play())}
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
          <button
            type="button"
            aria-label={t`Stop`}
            className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-muted"
            onClick={stop}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        </>
      ) : (
        <button
          type="button"
          aria-label={t`Play`}
          className="p-1 rounded hover:bg-discord-dark-500/50 text-discord-text-normal"
          onClick={play}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  );
};

// react-player v3 dropped SoundCloud; we drive the iframe via the SC Widget postMessage API.
// The widget auto-sends "ready" on load; we subscribe to play/pause/finish in response.
const SoundCloudEmbed: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [embedError, setEmbedError] = useState(false);

  const height = /\/sets\//.test(url) ? 350 : 166;
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`;

  const pauseWidget = () => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ method: "pause" }),
      "https://w.soundcloud.com",
    );
  };

  useMediaController({
    url,
    type: "embed",
    msgid,
    serverId,
    channelId,
    onExternalStop: pauseWidget,
    onExternalPause: pauseWidget,
    stopOnUnmount: true, // no hidden fallback player — clear store on unmount
  });

  useEffect(() => {
    const subscribeToWidget = () => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      for (const event of ["play", "pause", "finish"]) {
        win.postMessage(
          JSON.stringify({ method: "addEventListener", value: event }),
          "https://w.soundcloud.com",
        );
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== "https://w.soundcloud.com") return;
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow)
        return;
      let data: { method?: string };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data.method === "ready") {
        subscribeToWidget();
      } else if (data.method === "play") {
        useStore
          .getState()
          .playMedia(url, "embed", undefined, msgid, serverId, channelId);
      } else if (data.method === "pause" || data.method === "finish") {
        useStore.getState().pauseActiveMedia();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [url, msgid, serverId, channelId]);

  if (embedError) return null;

  return (
    <div className="max-w-md relative">
      <iframe
        ref={iframeRef}
        src={src}
        width="100%"
        height={height}
        scrolling="no"
        frameBorder="0"
        allow="autoplay"
        title={t`SoundCloud player`}
        tabIndex={-1}
        style={{ borderRadius: 4, display: "block" }}
        onError={() => setEmbedError(true)}
      />
    </div>
  );
};

const EmbedPreview: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const mediaViewerOpen = useStore((state) => state.ui.openedMedia !== null);
  const [playerKey, setPlayerKey] = useState(0);
  const [embedError, setEmbedError] = useState(false);

  const { isActive, isPlaying } = useMediaController({
    url,
    type: "embed",
    thumbnailUrl: getEmbedThumbnailUrl(url) ?? undefined,
    msgid,
    serverId,
    channelId,
    // Remount the iframe when this embed goes from active → inactive so YouTube/Vimeo resets.
    onExternalStop: () => setPlayerKey((k) => k + 1),
    inlineVisibility: {},
  });

  // undefined when inactive: leave the iframe uncontrolled so the user can
  // interact with YouTube natively. The playerKey reset above handles the
  // "reset to beginning on stop" without needing to force-pause the iframe.
  const playing = mediaViewerOpen ? false : isActive ? isPlaying : undefined;

  // Spotify's embed player is a portrait list/player, not 16:9 video.
  // Tracks have a compact single-row layout; playlists/albums/shows need
  // more height to show the track list. Everything else gets aspect-video.
  const spotifyHeight = url.includes("open.spotify.com")
    ? /\/(track|episode)\//.test(url)
      ? 152
      : 380
    : null;

  if (embedError) return null;

  return (
    <div className="max-w-md relative group">
      <Suspense
        fallback={
          <div
            className={`w-full bg-discord-dark-400/50 rounded animate-pulse ${spotifyHeight ? "" : "aspect-video"}`}
            style={spotifyHeight ? { height: spotifyHeight } : undefined}
          />
        }
      >
        <div
          className={spotifyHeight ? undefined : "aspect-video"}
          style={spotifyHeight ? { height: spotifyHeight } : undefined}
        >
          <ReactPlayer
            key={playerKey}
            src={url}
            width="100%"
            height="100%"
            controls
            playing={playing}
            config={{
              youtube: { disablekb: 1 },
              vimeo: { keyboard: false },
            }}
            style={{ borderRadius: "4px", overflow: "hidden" }}
            onPlay={() => {
              // Guard against spurious onPlay events fired by YouTube.
              // If the user explicitly paused (isPlaying=false in store), ignore the event.
              const current = useStore.getState().ui.activeMedia;
              if (current?.url === url && current.isPlaying === false) return;
              useStore
                .getState()
                .playMedia(
                  url,
                  "embed",
                  getEmbedThumbnailUrl(url) ?? undefined,
                  msgid,
                  serverId,
                  channelId,
                );
            }}
            onPause={() => useStore.getState().pauseActiveMedia()}
            onEnded={() => {
              // Reset player to beginning and pause — prevents YouTube recommendations screen
              setPlayerKey((k) => k + 1);
              useStore.getState().pauseActiveMedia();
            }}
            onError={() => setEmbedError(true)}
          />
        </div>
      </Suspense>
    </div>
  );
};

const PdfPreview: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
}> = ({ url, msgid, serverId, channelId }) => {
  const openMedia = useStore((state) => state.openMedia);
  const [pdfError, setPdfError] = useState(false);
  const [imgError, setImgError] = useState(false);

  // w-fit hugs the canvas so no white space bleeds around the document.
  const wrapper = (children: React.ReactNode) => (
    <div
      className="bg-white w-fit cursor-pointer rounded border border-discord-dark-500/50 overflow-hidden hover:opacity-90 transition-opacity shadow-sm"
      onClick={() => openMedia(url, msgid, serverId, channelId)}
    >
      {children}
    </div>
  );

  if (pdfError) {
    // react-pdf failed (CORS). Try <img>: WebKit renders PDFs in <img> natively.
    if (!imgError) {
      return wrapper(
        <img
          src={url}
          alt={t`PDF preview`}
          style={{ width: PDF_THUMB_W, maxHeight: PDF_THUMB_H }}
          className="object-cover object-top block"
          onError={() => setImgError(true)}
        />,
      );
    }
    // Both failed — show a PDF icon with the filename.
    return wrapper(
      <div
        style={{ width: PDF_THUMB_W, height: PDF_THUMB_H }}
        className="flex flex-col items-center justify-center gap-2 text-discord-text-muted p-2"
      >
        <FaFileAlt className="text-3xl opacity-60" />
        <span className="text-xs text-center break-all line-clamp-2 leading-tight">
          {filenameFromUrl(url)}
        </span>
      </div>,
    );
  }

  return wrapper(
    <Suspense
      fallback={
        <div
          style={{ width: PDF_THUMB_W, height: PDF_THUMB_H }}
          className="bg-discord-dark-400/50 animate-pulse"
        />
      }
    >
      <LazyDocument
        file={url}
        options={{ isEvalSupported: false }}
        loading={null}
        onLoadError={() => setPdfError(true)}
      >
        <LazyPage
          pageNumber={1}
          width={PDF_THUMB_W}
          canvasBackground="white"
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </LazyDocument>
    </Suspense>,
  );
};

// Probes a URL whose type is unknown, then renders the appropriate preview.
// Probe is deferred until the element is near the viewport (IntersectionObserver).
// Callers must pre-filter URLs through canShowMedia() — probe runs unconditionally here.
const ProbeablePreview: React.FC<{
  url: string;
  msgid?: string;
  isFilehostImage?: boolean;
  serverId?: string;
  channelId?: string;
  onOpenProfile?: (username: string) => void;
  onTypeResolved?: (url: string, type: MediaType) => void;
}> = ({
  url,
  msgid,
  isFilehostImage,
  serverId,
  channelId,
  onOpenProfile,
  onTypeResolved,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resolvedType, setResolvedType] = useState<MediaType | null>(null);

  useEffect(() => {
    setResolvedType(null);
    const el = wrapperRef.current;
    if (!el) return;
    let cancelled = false;
    // rootMargin starts probe 200px before the element enters the viewport
    // so the preview is ready by the time the user scrolls to it.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        probeMediaUrl(url).then((result) => {
          if (!cancelled && result && !result.skipped) {
            setResolvedType(result.type);
            onTypeResolved?.(url, result.type);
          }
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [url, onTypeResolved]);

  let preview: React.ReactNode = null;
  if (resolvedType === "image") {
    preview = (
      <ImagePreview
        url={url}
        msgid={msgid}
        isFilehostImage={isFilehostImage}
        serverId={serverId}
        channelId={channelId}
        onOpenProfile={onOpenProfile}
      />
    );
  } else if (resolvedType === "video") {
    preview = (
      <VideoPreview
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  } else if (resolvedType === "audio") {
    preview = (
      <AudioPreview
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  } else if (resolvedType === "pdf") {
    preview = (
      <PdfPreview
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  } else if (resolvedType === "embed") {
    preview = url.includes("soundcloud.com") ? (
      <SoundCloudEmbed
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    ) : (
      <EmbedPreview
        url={url}
        msgid={msgid}
        serverId={serverId}
        channelId={channelId}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={resolvedType ? undefined : { minHeight: "1px" }}
    >
      {preview}
    </div>
  );
};

export const MediaPreview: React.FC<{
  entry: MediaEntry;
  msgid?: string;
  isFilehostImage?: boolean;
  serverId?: string;
  channelId?: string;
  onOpenProfile?: (username: string) => void;
  onTypeResolved?: (url: string, type: MediaType) => void;
}> = ({
  entry,
  msgid,
  isFilehostImage,
  serverId,
  channelId,
  onOpenProfile,
  onTypeResolved,
}) => {
  if (entry.type === null) {
    return (
      <ProbeablePreview
        url={entry.url}
        msgid={msgid}
        isFilehostImage={isFilehostImage}
        serverId={serverId}
        channelId={channelId}
        onOpenProfile={onOpenProfile}
        onTypeResolved={onTypeResolved}
      />
    );
  }

  switch (entry.type) {
    case "image":
      return (
        <ImagePreview
          url={entry.url}
          msgid={msgid}
          isFilehostImage={isFilehostImage}
          serverId={serverId}
          channelId={channelId}
          onOpenProfile={onOpenProfile}
        />
      );
    case "video":
      return (
        <VideoPreview
          url={entry.url}
          msgid={msgid}
          serverId={serverId}
          channelId={channelId}
        />
      );
    case "audio":
      return (
        <AudioPreview
          url={entry.url}
          msgid={msgid}
          serverId={serverId}
          channelId={channelId}
        />
      );
    case "pdf":
      return (
        <PdfPreview
          url={entry.url}
          msgid={msgid}
          serverId={serverId}
          channelId={channelId}
        />
      );
    case "embed":
      if (entry.url.includes("soundcloud.com")) {
        return (
          <SoundCloudEmbed
            url={entry.url}
            msgid={msgid}
            serverId={serverId}
            channelId={channelId}
          />
        );
      }
      return (
        <EmbedPreview
          url={entry.url}
          msgid={msgid}
          serverId={serverId}
          channelId={channelId}
        />
      );
  }
};
