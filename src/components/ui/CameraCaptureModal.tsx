import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaBolt,
  FaCamera,
  FaCheck,
  FaSyncAlt,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import { pickVideoRecordingFormat } from "../../lib/audioRecording";
import { usePhysicalAngle } from "../../lib/deviceRotation";
import {
  type AutoStopReason,
  type LimitedRecording,
  startLimitedRecording,
} from "../../lib/limitedRecording";
import {
  audioConstraints,
  describeMediaError,
  listDevices,
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

// A photo is a single frame, so we ask a phone for more pixels than a recording or a call uses.
const PHOTO_SIZE: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };

function hasTorch(track: MediaStreamTrack): boolean {
  const capabilities = track.getCapabilities?.() as
    | (MediaTrackCapabilities & { torch?: boolean })
    | undefined;
  return capabilities?.torch === true;
}

type Mode = "photo" | "video";
type Status =
  | "starting"
  | "ready"
  | "arming"
  | "recording"
  | "review"
  | "error";

interface Capture {
  file: File;
  url: string;
  video: boolean;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

// We open the microphone only while a video records, so taking a photo never
// lights the mic indicator. A denied mic records a silent video.
async function addMicrophone(stream: MediaStream): Promise<boolean> {
  const settings = useStore.getState().globalSettings;
  const deviceId = resolveDeviceId(
    settings.callAudioInput,
    await listDevices("audioinput"),
  );
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints(settings, deviceId),
    });
    for (const track of mic.getAudioTracks()) stream.addTrack(track);
    return true;
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
    return false;
  }
}

function removeMicrophone(stream: MediaStream): void {
  for (const track of stream.getAudioTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
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
  // Touch devices take the default camera, so getUserMedia asks for access itself.
  const needsDeviceAccess = !isTouch && videoAccess.needsPermission;

  const [mode, setMode] = useState<Mode>("photo");
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [previewTrack, setPreviewTrack] = useState<
    MediaStreamTrack | undefined
  >(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [stoppedBy, setStoppedBy] = useState<AutoStopReason | null>(null);
  const [isSilent, setIsSilent] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [isTorchAvailable, setIsTorchAvailable] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  // The light stays on across a switch between photo and video, which reopens the camera.
  const isTorchWantedRef = useRef(false);
  const physicalAngle = usePhysicalAngle(isOpen && isTouch);

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
    if (mountedRef.current) {
      setPreviewTrack(undefined);
      setIsTorchAvailable(false);
      setIsTorchOn(false);
    }
  }, []);

  const setTorch = useCallback(
    async (track: MediaStreamTrack, isOn: boolean) => {
      try {
        await track.applyConstraints({
          advanced: [{ torch: isOn } as TorchConstraints],
        });
        if (mountedRef.current) setIsTorchOn(isOn);
      } catch (err) {
        if (!(err instanceof DOMException)) throw err;
        if (mountedRef.current) setIsTorchAvailable(false);
      }
    },
    [],
  );

  const openCamera = useCallback(
    async (forMode: Mode = "photo") => {
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
        const constraints = videoConstraints(settings, deviceId, isTouch);
        stream = await navigator.mediaDevices.getUserMedia({
          video:
            isTouch && forMode === "photo"
              ? { ...constraints, ...PHOTO_SIZE }
              : constraints,
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
      const track = stream.getVideoTracks()[0];
      setPreviewTrack(track);
      const canTorch = !!track && hasTorch(track);
      setIsTorchAvailable(canTorch);
      if (canTorch && isTorchWantedRef.current) void setTorch(track, true);
      setStatus("ready");
    },
    [isTouch, release, setTorch, videoAccess.devices],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: openCamera and release are stable; reopening on every device-list change would restart the viewfinder under the person using it
  useEffect(() => {
    if (!isOpen || needsDeviceAccess) return;
    setMode("photo");
    setCapture(null);
    void openCamera();
    return () => {
      release();
    };
  }, [isOpen, needsDeviceAccess]);

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
    const isFrontCamera = mirrorsCamera(true, globalSettings.callCameraFacing);
    const file = await capturePhotoFile(video, {
      track: streamRef.current?.getVideoTracks()[0],
      rotation: isTouch ? physicalAngle.rotationFor(isFrontCamera) : 0,
    });
    if (!file || !mountedRef.current) return;
    keepCapture(file, false);
  };

  const startRecording = async () => {
    const stream = streamRef.current;
    const format = pickVideoRecordingFormat();
    if (!stream || !format) {
      setStatus("error");
      setError(t`This browser cannot record video.`);
      return;
    }
    setStatus("arming");
    const hasMic = await addMicrophone(stream);
    if (stream !== streamRef.current || !mountedRef.current) {
      removeMicrophone(stream);
      return;
    }
    setIsSilent(!hasMic);
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
          removeMicrophone(stream);
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
    else void startRecording();
  };

  const handleRetake = () => {
    setCapture(null);
    setStoppedBy(null);
    setStatus(streamRef.current ? "ready" : "starting");
    if (!streamRef.current) void openCamera(mode);
  };

  const handleAttach = () => {
    if (!capture) return;
    onCaptured(capture.file);
    release();
    onCloseRef.current();
  };

  const handleClose = () => {
    isTorchWantedRef.current = false;
    release();
    onCloseRef.current();
  };

  useModalBehavior({
    isOpen: isOpen && isTouch,
    onClose: handleClose,
    clickOutsideEnabled: false,
  });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen || !isTouch) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, [isOpen, isTouch]);

  const flipCamera = () => {
    updateGlobalSettings({
      callCameraFacing:
        globalSettings.callCameraFacing === "user" ? "environment" : "user",
    });
    void openCamera(mode);
  };

  const selectMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    if (isTouch) void openCamera(next);
  };

  const toggleTorch = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    isTorchWantedRef.current = !isTorchOn;
    void setTorch(track, !isTorchOn);
  };

  const mirror = mirrorsCamera(isTouch, globalSettings.callCameraFacing);
  const recording = status === "recording";

  const stopReasonMessage =
    stoppedBy === "size-limit"
      ? t`Reached the upload size limit, so the recording stopped here.`
      : stoppedBy === "duration-limit"
        ? t`Reached the maximum recording length, so the recording stopped here.`
        : null;

  const recordingBadge = recording && (
    <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white">
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
      <span className="font-mono text-sm tabular-nums">
        {formatElapsed(elapsedMs)}
      </span>
      <span className="font-mono text-xs tabular-nums opacity-70">
        {formatFileSize(sizeBytes)}
      </span>
    </div>
  );
  const notes = (
    <>
      {recording && isSilent && (
        <p className="text-center text-xs text-yellow-400">
          <Trans>Allow microphone access to record sound.</Trans>
        </p>
      )}
      {stopReasonMessage && (
        <p className="text-center text-xs text-yellow-400">
          {stopReasonMessage}
        </p>
      )}
    </>
  );
  const capturedMedia =
    capture &&
    (capture.video ? (
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
    ));

  // A phone gets the whole screen, laid out like the system camera: controls
  // under the viewfinder in portrait and in a column beside it in landscape.
  if (isTouch) {
    if (!isOpen) return null;
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t`Camera`}
        className="fixed inset-0 z-[10000] flex flex-col landscape:flex-row bg-black text-white"
        style={{
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
      >
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {status === "error" ? (
            <p className="p-6 pt-20 text-center text-sm text-red-400">
              {error}
            </p>
          ) : (
            (capturedMedia ?? (
              <VideoTrackView
                ref={videoRef}
                track={previewTrack}
                muted
                className={`h-full w-full ${mirror ? "scale-x-[-1]" : ""}`}
              />
            ))
          )}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label={t`Close`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50"
            >
              <FaTimes />
            </button>
            {recordingBadge}
            <div className="flex gap-3">
              {!capture && isTorchAvailable && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-label={
                    isTorchOn ? t`Turn flashlight off` : t`Turn flashlight on`
                  }
                  aria-pressed={isTorchOn}
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${isTorchOn ? "bg-yellow-300 text-black" : "bg-black/50"}`}
                >
                  <FaBolt />
                </button>
              )}
              {!capture && !recording && status !== "error" ? (
                <button
                  type="button"
                  onClick={flipCamera}
                  aria-label={t`Switch camera`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50"
                >
                  <FaSyncAlt />
                </button>
              ) : (
                <span className="w-11" />
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-4 px-6 pb-4 pt-4 landscape:w-36 landscape:shrink-0 landscape:justify-center landscape:px-3 landscape:py-3">
          {notes}
          {capture ? (
            <div className="flex w-full items-center justify-between landscape:flex-col-reverse landscape:gap-6">
              <button
                type="button"
                onClick={handleRetake}
                className="min-h-11 px-2 text-base"
              >
                <Trans>Retake</Trans>
              </button>
              <button
                type="button"
                onClick={handleAttach}
                className="button-primary min-h-11 rounded-full px-6 text-base"
              >
                {capture.video ? (
                  <Trans>Use video</Trans>
                ) : (
                  <Trans>Use photo</Trans>
                )}
              </button>
            </div>
          ) : (
            <>
              {!recording && (
                <div className="flex gap-8 text-sm font-semibold uppercase tracking-wider landscape:order-last landscape:flex-col landscape:items-center landscape:gap-4">
                  {(["photo", "video"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => selectMode(option)}
                      aria-pressed={mode === option}
                      className={
                        mode === option ? "text-yellow-300" : "text-white/60"
                      }
                    >
                      {option === "photo" ? (
                        <Trans>Photo</Trans>
                      ) : (
                        <Trans>Video</Trans>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleShutter}
                disabled={
                  status === "starting" ||
                  status === "arming" ||
                  status === "error"
                }
                aria-label={
                  recording
                    ? t`Stop recording`
                    : mode === "photo"
                      ? t`Take photo`
                      : t`Start recording`
                }
                className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
              >
                <span
                  className={`transition-all ${
                    recording
                      ? "h-7 w-7 rounded-md bg-red-500"
                      : mode === "photo"
                        ? "h-[58px] w-[58px] rounded-full bg-white"
                        : "h-[58px] w-[58px] rounded-full bg-red-500"
                  }`}
                />
              </button>
            </>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t`Camera`}
      maxWidth="lg"
    >
      <ModalBody className="gap-3">
        {needsDeviceAccess ? (
          <DeviceAccessGate
            needsPermission
            requesting={videoAccess.requesting}
            error={videoAccess.permissionError}
            onRequestAccess={() => void videoAccess.requestAccess()}
            message={
              <Trans>Allow camera access to take a photo or video.</Trans>
            }
            buttonLabel={<Trans>Allow camera access</Trans>}
          />
        ) : status === "error" ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="relative flex-1 min-h-[240px] overflow-hidden rounded-lg bg-black">
              {capturedMedia || (
                <VideoTrackView
                  ref={videoRef}
                  track={previewTrack}
                  muted
                  className={`h-full w-full ${mirror ? "scale-x-[-1]" : ""}`}
                />
              )}
              {recordingBadge && (
                <div className="absolute left-3 top-3">{recordingBadge}</div>
              )}
            </div>
            {notes}
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
                  disabled={status === "starting" || status === "arming"}
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
            onClick={handleAttach}
            className="button-primary min-h-11 rounded px-4 py-2"
          >
            <FaCheck className="mr-2 inline" />
            <Trans>Attach</Trans>
          </button>
        </ModalFooter>
      )}
    </BaseModal>
  );
}

export default CameraCaptureModal;
