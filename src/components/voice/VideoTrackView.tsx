import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

// WebKit's own presentation API, which iOS web views keep when they turn the
// standard Picture-in-Picture API off.
type WebkitPresentationMode = "inline" | "picture-in-picture" | "fullscreen";

declare global {
  interface HTMLVideoElement {
    webkitSupportsPresentationMode?: (mode: WebkitPresentationMode) => boolean;
    webkitSetPresentationMode?: (mode: WebkitPresentationMode) => void;
    webkitPresentationMode?: WebkitPresentationMode;
  }
}

interface VideoTrackViewProps {
  track: MediaStreamTrack | undefined;
  muted?: boolean;
  contain?: boolean;
  className?: string;
}

/** The only place in the app that binds a voice track to a <video>
 *  element. Used by the stage tiles and the floating pop-out card so
 *  both get the same autoplay-retry and teardown behavior. */
export const VideoTrackView = forwardRef<HTMLVideoElement, VideoTrackViewProps>(
  ({ track, muted, contain, className }, forwardedRef) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(
      forwardedRef,
      () => videoRef.current as HTMLVideoElement,
    );

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      if (!track) {
        video.srcObject = null;
        return;
      }
      video.srcObject = new MediaStream([track]);
      video.play().catch(() => {});
      return () => {
        video.srcObject = null;
      };
    }, [track]);

    return (
      <video
        ref={videoRef}
        data-call-video
        className={`${contain ? "object-contain" : "object-cover"} ${className ?? ""}`}
        autoPlay
        playsInline
        muted={muted}
      />
    );
  },
);
VideoTrackView.displayName = "VideoTrackView";

const PIP_EVENTS = [
  "enterpictureinpicture",
  "leavepictureinpicture",
  "webkitpresentationmodechanged",
];

function isAnyVideoInPip(): boolean {
  if (typeof document === "undefined") return false;
  if (document.pictureInPictureElement) return true;
  return Array.from(document.querySelectorAll("video")).some(
    (video) => video.webkitPresentationMode === "picture-in-picture",
  );
}

/** True while any video of the page plays in the system picture-in-picture
 *  window. The PiP events do not bubble, so we listen in the capture phase. */
export function useIsVideoPipActive(): boolean {
  const [isActive, setIsActive] = useState(isAnyVideoInPip);
  useEffect(() => {
    const update = () => setIsActive(isAnyVideoInPip());
    for (const name of PIP_EVENTS) {
      document.addEventListener(name, update, true);
    }
    return () => {
      for (const name of PIP_EVENTS) {
        document.removeEventListener(name, update, true);
      }
    };
  }, []);
  return isActive;
}

function isWebkitPipSupported(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("video");
  return probe.webkitSupportsPresentationMode?.("picture-in-picture") ?? false;
}

export function pipSupported(): boolean {
  if (typeof document === "undefined") return false;
  const isStandardPipEnabled =
    "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  return isStandardPipEnabled || isWebkitPipSupported();
}

/** Toggle native picture-in-picture on a tile's video element. Callers
 *  only need to render the PiP button when pipSupported() is true. */
export async function onPipRequest(
  video: HTMLVideoElement | null,
): Promise<void> {
  if (!video || !pipSupported()) return;
  try {
    if (!document.pictureInPictureEnabled && video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode(
        video.webkitPresentationMode === "picture-in-picture"
          ? "inline"
          : "picture-in-picture",
      );
      return;
    }
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (err) {
    console.warn("voice: requestPictureInPicture failed", err);
  }
}
