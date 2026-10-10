import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheck, FaCircle, FaStop, FaTrash } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useMicLevelMeter } from "../../hooks/useMicLevelMeter";
import {
  pickRecordingFormat,
  pickVideoRecordingFormat,
} from "../../lib/audioRecording";
import {
  type AutoStopReason,
  type LimitedRecording,
  startLimitedRecording,
} from "../../lib/limitedRecording";
import {
  audioConstraints,
  captureScreen,
  describeMediaError,
  mirrorsCamera,
  resolveDeviceId,
  videoConstraints,
} from "../../lib/mediaDevices";
import { formatFileSize } from "../../lib/mediaUpload";
import useStore from "../../store";
import { DockButton } from "../voice/DockButton";
import { VideoTrackView } from "../voice/VideoTrackView";
import { MicLevelMeter } from "./MicLevelMeter";
import { Popover } from "./Popover";
import {
  CameraFacingToggle,
  DeviceAccessGate,
} from "./settings/CallDeviceShared";
import { useDeviceAccess } from "./settings/useDeviceAccess";

export type RecordingKind = "audio" | "video" | "screen";

interface RecordingPanelProps {
  kind: RecordingKind;
  isOpen: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  onRecorded: (file: File) => void;
  /** Server's real upload cap (with safety margin already applied), or the
   *  fallback when the server exposes no policy. See recordingLimits.ts. */
  maxBytes: number;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type Status = "starting" | "recording" | "stopped" | "error";

const FILE_PREFIX: Record<RecordingKind, string> = {
  audio: "voice-message",
  video: "video-message",
  screen: "screen-recording",
};

/** We release every capture this opens on discard, send and close, so a
 *  torn-down recording never leaves a camera or microphone held. */
export function RecordingPanel({
  kind,
  isOpen,
  anchor,
  onClose,
  onRecorded,
  maxBytes,
}: RecordingPanelProps) {
  const { t } = useLingui();
  const isTouch = useIsTouchInput();
  const globalSettings = useStore((s) => s.globalSettings);
  const updateGlobalSettings = useStore((s) => s.updateGlobalSettings);

  const audioAccess = useDeviceAccess("audioinput");
  const videoAccess = useDeviceAccess("videoinput");
  const deviceAccess =
    kind === "audio" ? audioAccess : kind === "video" ? videoAccess : null;
  // Touch devices record from the default camera, so getUserMedia asks for
  // camera access itself.
  const needsPermission =
    !(kind === "video" && isTouch) && (deviceAccess?.needsPermission ?? false);

  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [meterStream, setMeterStream] = useState<MediaStream | null>(null);
  const [previewTrack, setPreviewTrack] = useState<
    MediaStreamTrack | undefined
  >(undefined);
  const [stoppedFile, setStoppedFile] = useState<File | null>(null);
  const [autoStopReason, setAutoStopReason] = useState<AutoStopReason | null>(
    null,
  );
  const { level: micLevel, hasSound } = useMicLevelMeter(meterStream);
  // We start the recorder the moment the device opens, so nothing is lost, and
  // only light the dot once sound arrives, which is when talking gets heard.
  const isHearing = status === "recording" && (kind !== "audio" || hasSound);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const mountedRef = useRef(true);
  const genRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<LimitedRecording | null>(null);

  // Stops the tick, the recorder (without emitting a file), and every
  // captured track. Safe to call multiple times.
  const release = useCallback(() => {
    genRef.current++;
    recordingRef.current?.release();
    recordingRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (mountedRef.current) {
      setMeterStream(null);
      setPreviewTrack(undefined);
    }
  }, []);

  const start = useCallback(async () => {
    release();
    const generation = genRef.current;
    setAutoStopReason(null);
    setStoppedFile(null);
    setStatus("starting");
    setElapsedMs(0);

    const format =
      kind === "audio" ? pickRecordingFormat() : pickVideoRecordingFormat();
    if (!format) {
      if (mountedRef.current) {
        setStatus("error");
        setError(
          kind === "audio"
            ? t`This browser cannot record audio.`
            : t`This browser cannot record video.`,
        );
      }
      return;
    }

    let stream: MediaStream;
    try {
      if (kind === "audio") {
        const settings = useStore.getState().globalSettings;
        const deviceId = resolveDeviceId(
          settings.callAudioInput,
          audioAccess.devices,
        );
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(settings, deviceId),
        });
      } else if (kind === "video") {
        const settings = useStore.getState().globalSettings;
        const deviceId = isTouch
          ? undefined
          : resolveDeviceId(settings.callVideoInput, videoAccess.devices);
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(settings, deviceId, isTouch),
        });
      } else {
        stream = await captureScreen(() => {
          if (generation !== genRef.current) return;
          recordingRef.current?.stop();
        });
      }
    } catch (err) {
      if (generation === genRef.current && mountedRef.current) {
        setStatus("error");
        setError(describeMediaError(err));
      }
      return;
    }
    if (generation !== genRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    streamRef.current = stream;
    if (kind === "audio") {
      setMeterStream(stream);
    } else {
      setPreviewTrack(stream.getVideoTracks()[0]);
    }

    recordingRef.current = startLimitedRecording(
      stream,
      {
        format,
        filePrefix: FILE_PREFIX[kind],
        maxBytes,
        video: kind !== "audio",
      },
      {
        onProgress: ({ elapsedMs: elapsed, sizeBytes: size }) => {
          if (!mountedRef.current) return;
          setElapsedMs(elapsed);
          setSizeBytes(size);
        },
        onFile: (file, reason) => {
          recordingRef.current = null;
          release();
          if (reason) {
            if (mountedRef.current) {
              setAutoStopReason(reason);
              setStoppedFile(file);
              setStatus("stopped");
            }
            return;
          }
          onRecordedRef.current(file);
          onCloseRef.current();
        },
      },
    );

    if (mountedRef.current) {
      setStatus("recording");
      setError(null);
      setElapsedMs(0);
      setSizeBytes(0);
    }
  }, [
    release,
    kind,
    isTouch,
    t,
    maxBytes,
    audioAccess.devices,
    videoAccess.devices,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: start and release are stable callbacks; a change of kind has to retake the capture, since switching straight from one recorder to another would otherwise keep the old device running and hand back its file.
  useEffect(() => {
    if (!isOpen || needsPermission) return;
    void start();
    return () => {
      release();
    };
  }, [isOpen, needsPermission, kind]);

  const handleFacingChange = (facing: "user" | "environment") => {
    updateGlobalSettings({ callCameraFacing: facing });
    void start();
  };

  const handlePrimaryAction = () => {
    if (status === "stopped") {
      if (stoppedFile) {
        onRecordedRef.current(stoppedFile);
        onCloseRef.current();
      }
      return;
    }
    recordingRef.current?.stop();
  };

  const handleDiscard = () => {
    release();
    setStoppedFile(null);
    onCloseRef.current();
  };

  const title =
    kind === "audio"
      ? t`Record voice message`
      : kind === "video"
        ? t`Record video message`
        : t`Record screen`;

  const stopReasonMessage =
    autoStopReason === "size-limit"
      ? t`Reached the upload size limit. Recording stopped: send it, or discard it.`
      : autoStopReason === "duration-limit"
        ? t`Reached the maximum recording length. Recording stopped: send it, or discard it.`
        : null;

  const showFacingToggle = kind === "video" && isTouch;
  const mirror =
    kind === "video" && mirrorsCamera(isTouch, globalSettings.callCameraFacing);

  return (
    <Popover
      isOpen={isOpen}
      onClose={handleDiscard}
      anchor={anchor}
      width={kind === "audio" ? 280 : 340}
      title={title}
    >
      <div className="p-4 space-y-4">
        {needsPermission && deviceAccess ? (
          <DeviceAccessGate
            needsPermission
            requesting={deviceAccess.requesting}
            error={deviceAccess.permissionError}
            onRequestAccess={() => void deviceAccess.requestAccess()}
            message={
              kind === "video" ? (
                <Trans>
                  Device names are hidden until you allow camera access.
                </Trans>
              ) : (
                <Trans>
                  Device names are hidden until you allow microphone access.
                </Trans>
              )
            }
            buttonLabel={
              kind === "video" ? (
                <Trans>Allow camera access</Trans>
              ) : (
                <Trans>Allow microphone access</Trans>
              )
            }
          />
        ) : status === "error" ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            {kind !== "audio" && (
              <div className="aspect-video w-full rounded-lg overflow-hidden bg-discord-dark-400">
                <VideoTrackView
                  track={previewTrack}
                  muted
                  contain={kind === "screen"}
                  className={`w-full h-full ${mirror ? "scale-x-[-1]" : ""}`}
                />
              </div>
            )}
            {showFacingToggle && (
              <CameraFacingToggle
                facing={globalSettings.callCameraFacing}
                onChange={handleFacingChange}
                disabled={status === "recording" || status === "stopped"}
              />
            )}
            <div className="flex items-center justify-center gap-2 text-discord-text-normal">
              <FaCircle
                className={`h-2 w-2 ${
                  isHearing
                    ? "text-red-500 animate-pulse"
                    : "text-discord-text-muted"
                }`}
              />
              <span className="font-mono text-lg tabular-nums">
                {formatElapsed(elapsedMs)}
              </span>
              {kind !== "audio" && (
                <span className="font-mono text-xs text-discord-text-muted tabular-nums">
                  · {formatFileSize(sizeBytes)}
                </span>
              )}
            </div>
            {kind === "audio" && <MicLevelMeter level={micLevel} />}
            {kind === "audio" && status === "recording" && !hasSound && (
              <p className="text-xs text-discord-text-muted text-center">
                <Trans>Start talking once the dot turns red</Trans>
              </p>
            )}
            {stopReasonMessage && (
              <p className="text-xs text-yellow-400 text-center">
                {stopReasonMessage}
              </p>
            )}
            <div className="flex items-center gap-2">
              <DockButton
                icon={<FaTrash />}
                state="neutral"
                label={t`Discard`}
                onClick={handleDiscard}
              />
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={status === "starting"}
                className="button-primary min-h-11 flex-1 rounded px-3 py-2"
              >
                {status === "stopped" ? (
                  <>
                    <FaCheck className="inline mr-2" />
                    <Trans>Attach</Trans>
                  </>
                ) : (
                  <>
                    <FaStop className="inline mr-2" />
                    <Trans>Stop</Trans>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

export default RecordingPanel;
