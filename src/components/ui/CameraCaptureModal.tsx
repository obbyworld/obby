import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCamera, FaCheck, FaSyncAlt, FaTrash } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { pickVideoRecordingFormat } from "../../lib/audioRecording";
import {
  type AutoStopReason,
  type LimitedRecording,
  startLimitedRecording,
} from "../../lib/limitedRecording";
import {
  describeMediaError,
  mirrorsCamera,
  resolveDeviceId,
  videoConstraints,
} from "../../lib/mediaDevices";
import { formatFileSize } from "../../lib/mediaUpload";
import BaseModal from "../../lib/modal/BaseModal";
import { ModalBody, ModalFooter } from "../../lib/modal/components";
import { capturePhotoFile } from "../../lib/photoCapture";
import useStore from "../../store";
import { VideoTrackView } from "../voice/VideoTrackView";
import { SegmentedControl } from "./SegmentedControl";
import { DeviceAccessGate } from "./settings/CallDeviceShared";
import { useDeviceAccess } from "./settings/useDeviceAccess";

const VIDEO_FILE_PREFIX = "video-message";

type Mode = "photo" | "video";
type Status = "starting" | "ready" | "recording" | "review" | "error";

interface Capture {
  file: File;
  url: string;
  video: boolean;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** The camera, opened as its own page on a phone: a live viewfinder first,
 *  then a photo or a recording taken from it, then a look at the result before
 *  anything is sent. */
export function CameraCaptureModal({
  isOpen,
  onClose,
  onCaptured,
  maxBytes,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCaptured: (file: File) => void;
  maxBytes: number;
}) {
  const { t } = useLingui();
  const isTouch = useIsTouchInput();
  const globalSettings = useStore((s) => s.globalSettings);
  const updateGlobalSettings = useStore((s) => s.updateGlobalSettings);
  const videoAccess = useDeviceAccess("videoinput");

  const [mode, setMode] = useState<Mode>("photo");
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [previewTrack, setPreviewTrack] = useState<
    MediaStreamTrack | undefined
  >(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [stoppedBy, setStoppedBy] = useState<AutoStopReason | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<LimitedRecording | null>(null);
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const release = useCallback(() => {
    genRef.current++;
    recordingRef.current?.release();
    recordingRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (mountedRef.current) setPreviewTrack(undefined);
  }, []);

  const openCamera = useCallback(async () => {
    release();
    const generation = genRef.current;
    setStatus("starting");
    setError(null);
    const settings = useStore.getState().globalSettings;
    const deviceId = isTouch
      ? undefined
      : resolveDeviceId(settings.callVideoInput, videoAccess.devices);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(settings, deviceId, isTouch),
        audio: true,
      });
    } catch (err) {
      if (generation === genRef.current && mountedRef.current) {
        setStatus("error");
        setError(describeMediaError(err));
      }
      return;
    }
    // A capture that lands after the camera was closed has nothing left to
    // stop it, so it would hold the device until the app quits.
    if (generation !== genRef.current || !mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    streamRef.current = stream;
    setPreviewTrack(stream.getVideoTracks()[0]);
    setStatus("ready");
  }, [isTouch, release, videoAccess.devices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: openCamera and release are stable; reopening on every device-list change would restart the viewfinder under the person using it
  useEffect(() => {
    if (!isOpen || videoAccess.needsPermission) return;
    setMode("photo");
    setCapture(null);
    void openCamera();
    return () => {
      release();
    };
  }, [isOpen, videoAccess.needsPermission]);

  useEffect(() => {
    if (!capture) return;
    return () => URL.revokeObjectURL(capture.url);
  }, [capture]);

  const keepCapture = (file: File, video: boolean) => {
    setCapture({ file, url: URL.createObjectURL(file), video });
    setStatus("review");
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const file = await capturePhotoFile(video);
    if (!file || !mountedRef.current) return;
    keepCapture(file, false);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    const format = pickVideoRecordingFormat();
    if (!stream || !format) {
      setStatus("error");
      setError(t`This browser cannot record video.`);
      return;
    }
    setElapsedMs(0);
    setSizeBytes(0);
    setStoppedBy(null);
    recordingRef.current = startLimitedRecording(
      stream,
      { format, filePrefix: VIDEO_FILE_PREFIX, maxBytes, video: true },
      {
        onProgress: ({ elapsedMs: elapsed, sizeBytes: size }) => {
          if (!mountedRef.current) return;
          setElapsedMs(elapsed);
          setSizeBytes(size);
        },
        onFile: (file, reason) => {
          recordingRef.current = null;
          if (!mountedRef.current) return;
          setStoppedBy(reason);
          keepCapture(file, true);
        },
      },
    );
    setStatus("recording");
  };

  const handleShutter = () => {
    if (status === "recording") {
      recordingRef.current?.stop();
      return;
    }
    if (mode === "photo") void takePhoto();
    else startRecording();
  };

  const handleRetake = () => {
    setCapture(null);
    setStoppedBy(null);
    setStatus(streamRef.current ? "ready" : "starting");
    if (!streamRef.current) void openCamera();
  };

  const handleSend = () => {
    if (!capture) return;
    onCaptured(capture.file);
    release();
    onCloseRef.current();
  };

  const handleClose = () => {
    release();
    onCloseRef.current();
  };

  const flipCamera = () => {
    updateGlobalSettings({
      callCameraFacing:
        globalSettings.callCameraFacing === "user" ? "environment" : "user",
    });
    void openCamera();
  };

  const mirror = mirrorsCamera(isTouch, globalSettings.callCameraFacing);
  const recording = status === "recording";

  const stopReasonMessage =
    stoppedBy === "size-limit"
      ? t`Reached the upload size limit, so the recording stopped here.`
      : stoppedBy === "duration-limit"
        ? t`Reached the maximum recording length, so the recording stopped here.`
        : null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t`Camera`}
      maxWidth="lg"
    >
      <ModalBody className="gap-3">
        {videoAccess.needsPermission ? (
          <DeviceAccessGate
            needsPermission
            requesting={videoAccess.requesting}
            error={videoAccess.permissionError}
            onRequestAccess={() => void videoAccess.requestAccess()}
            message={
              <Trans>
                Device names are hidden until you allow camera access.
              </Trans>
            }
            buttonLabel={<Trans>Allow camera access</Trans>}
          />
        ) : status === "error" ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="relative flex-1 min-h-[240px] overflow-hidden rounded-lg bg-black">
              {capture ? (
                capture.video ? (
                  <video
                    src={capture.url}
                    controls
                    playsInline
                    className="h-full w-full object-contain"
                  >
                    <track kind="captions" />
                  </video>
                ) : (
                  <img
                    src={capture.url}
                    alt={t`The photo you just took`}
                    className="h-full w-full object-contain"
                  />
                )
              ) : (
                <VideoTrackView
                  ref={videoRef}
                  track={previewTrack}
                  muted
                  className={`h-full w-full ${mirror ? "scale-x-[-1]" : ""}`}
                />
              )}
              {isTouch && !capture && !recording && (
                <button
                  type="button"
                  onClick={flipCamera}
                  aria-label={t`Switch camera`}
                  className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white"
                >
                  <FaSyncAlt />
                </button>
              )}
              {recording && (
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  <span className="font-mono text-sm tabular-nums">
                    {formatElapsed(elapsedMs)}
                  </span>
                  <span className="font-mono text-xs tabular-nums opacity-70">
                    {formatFileSize(sizeBytes)}
                  </span>
                </div>
              )}
            </div>
            {stopReasonMessage && (
              <p className="text-center text-xs text-yellow-400">
                {stopReasonMessage}
              </p>
            )}
            {!capture && !recording && (
              <SegmentedControl
                value={mode}
                onChange={setMode}
                segments={[
                  { value: "photo" as const, label: <Trans>Photo</Trans> },
                  { value: "video" as const, label: <Trans>Video</Trans> },
                ]}
              />
            )}
            {!capture && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleShutter}
                  disabled={status === "starting"}
                  aria-label={
                    recording
                      ? t`Stop recording`
                      : mode === "photo"
                        ? t`Take photo`
                        : t`Start recording`
                  }
                  className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-white/10 text-white disabled:opacity-40"
                >
                  {recording ? (
                    <span className="h-6 w-6 rounded bg-red-500" />
                  ) : mode === "photo" ? (
                    <FaCamera className="h-6 w-6" />
                  ) : (
                    <span className="h-10 w-10 rounded-full bg-red-500" />
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </ModalBody>
      {capture && (
        <ModalFooter>
          <button
            type="button"
            onClick={handleRetake}
            className="min-h-11 rounded px-4 py-2 text-discord-text-normal hover:bg-discord-dark-400"
          >
            <FaTrash className="mr-2 inline" />
            <Trans>Retake</Trans>
          </button>
          <button
            type="button"
            onClick={handleSend}
            className="min-h-11 rounded bg-discord-primary px-4 py-2 text-white hover:opacity-90"
          >
            <FaCheck className="mr-2 inline" />
            <Trans>Send</Trans>
          </button>
        </ModalFooter>
      )}
    </BaseModal>
  );
}

export default CameraCaptureModal;
