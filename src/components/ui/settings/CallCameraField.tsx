import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCamera } from "react-icons/fa";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import {
  describeMediaError,
  mirrorsCamera,
  resolveDeviceId,
  videoConstraints,
} from "../../../lib/mediaDevices";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";
import { VideoTrackView } from "../../voice/VideoTrackView";
import {
  CameraFacingToggle,
  DeviceAccessGate,
  DeviceSelect,
} from "./CallDeviceShared";
import { useDeviceAccess } from "./useDeviceAccess";

/** Live camera picker with a mirrored preview and, on touch devices, a
 *  front/back facing choice. Every capture it opens is released on unmount,
 *  on device change, and when a capture resolves after either -- mirroring
 *  the generation guard in src/lib/voice.ts so this panel can never leave a
 *  device held open behind it. */
export const CallCameraField: React.FC<SettingComponentProps> = ({
  disabled,
}) => {
  const { t } = useLingui();
  const isTouch = useMediaQuery("(pointer: coarse)");
  const globalSettings = useStore((s) => s.globalSettings);
  const updateGlobalSettings = useStore((s) => s.updateGlobalSettings);
  const {
    devices,
    needsPermission,
    requesting,
    permissionError,
    requestAccess,
  } = useDeviceAccess("videoinput");

  const [camError, setCamError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const genRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewTrack, setPreviewTrack] = useState<
    MediaStreamTrack | undefined
  >();

  const release = useCallback(() => {
    genRef.current++;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setPreviewTrack(undefined);
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      release();
      const generation = genRef.current;
      const settings = useStore.getState().globalSettings;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(settings, deviceId, isTouch),
        });
      } catch (err) {
        if (generation === genRef.current && mountedRef.current) {
          setCamError(describeMediaError(err));
        }
        return;
      }
      if (generation !== genRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      if (mountedRef.current) setCamError(null);
      setPreviewTrack(stream.getVideoTracks()[0]);
    },
    [release, isTouch],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      release();
    };
  }, [release]);

  // Auto-start the preview once, the first time we learn whether labels are
  // already visible (permission granted in an earlier session).
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || devices.length === 0) return;
    startedRef.current = true;
    if (devices.some((d) => d.label !== "")) {
      void start(resolveDeviceId(globalSettings.callVideoInput, devices));
    }
  }, [devices, start, globalSettings.callVideoInput]);

  const handleChange = (deviceId: string) => {
    const device = devices.find((d) => d.deviceId === deviceId);
    updateGlobalSettings({
      callVideoInput: device
        ? { deviceId: device.deviceId, label: device.label }
        : null,
    });
    void start(deviceId || undefined);
  };

  const handleFacingChange = (facing: "user" | "environment") => {
    updateGlobalSettings({ callCameraFacing: facing });
    void start(undefined);
  };

  const handleRequestAccess = async () => {
    const found = await requestAccess();
    void start(resolveDeviceId(globalSettings.callVideoInput, found));
  };

  const selectedId =
    resolveDeviceId(globalSettings.callVideoInput, devices) ?? "";
  const mirrorCamera = mirrorsCamera(isTouch, globalSettings.callCameraFacing);

  return (
    <div className="space-y-3">
      <DeviceAccessGate
        needsPermission={needsPermission}
        requesting={requesting}
        error={permissionError}
        onRequestAccess={() => void handleRequestAccess()}
        disabled={disabled}
        message={
          <Trans>Device names are hidden until you allow camera access.</Trans>
        }
        buttonLabel={<Trans>Allow camera access</Trans>}
      />
      {!needsPermission &&
        (devices.length === 0 ? (
          <p className="text-xs text-discord-text-muted">
            <Trans>No camera detected.</Trans>
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-discord-text-normal">
              <FaCamera className="h-4 w-4" />
              <Trans>Camera</Trans>
            </div>
            {isTouch ? (
              <CameraFacingToggle
                facing={globalSettings.callCameraFacing}
                onChange={handleFacingChange}
                disabled={disabled}
              />
            ) : (
              <DeviceSelect
                devices={devices}
                value={selectedId}
                onChange={handleChange}
                disabled={disabled}
                labelFor={(d, i) => d.label || t`Camera ${i + 1}`}
              />
            )}
            <div className="aspect-video w-full max-w-xs overflow-hidden rounded bg-discord-dark-400">
              <VideoTrackView
                track={previewTrack}
                muted
                className={`h-full w-full ${mirrorCamera ? "scale-x-[-1]" : ""}`}
              />
            </div>
          </>
        ))}
      {camError && <p className="text-xs text-red-400">{camError}</p>}
    </div>
  );
};

export default CallCameraField;
