import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

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
        className={`${contain ? "object-contain" : "object-cover"} ${className ?? ""}`}
        autoPlay
        playsInline
        muted={muted}
      />
    );
  },
);
VideoTrackView.displayName = "VideoTrackView";

export function pipSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    "pictureInPictureEnabled" in document &&
    document.pictureInPictureEnabled
  );
}

/** Toggle native picture-in-picture on a tile's video element. Callers
 *  only need to render the PiP button when pipSupported() is true. */
export async function onPipRequest(
  video: HTMLVideoElement | null,
): Promise<void> {
  if (!video || !pipSupported()) return;
  try {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (err) {
    console.warn("voice: requestPictureInPicture failed", err);
  }
}
