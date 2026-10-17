import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaMicrophone } from "react-icons/fa";
import {
  audioConstraints,
  describeMediaError,
  resolveDeviceId,
} from "../../../lib/mediaDevices";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";
import { DeviceAccessGate, DeviceSelect } from "./CallDeviceShared";
import { useDeviceAccess } from "./useDeviceAccess";

const METER_BAR_COUNT = 16;
const METER_BAR_HEIGHTS = Array.from(
  { length: METER_BAR_COUNT },
  (_, i) => 30 + i * 4,
);

/** Live microphone picker with a level meter. Every capture it opens is
 *  released on unmount, on device change, and when a capture resolves after
 *  either -- mirroring the generation guard in src/lib/voice.ts so this
 *  panel can never leave a device held open behind it. */
export const CallMicrophoneField: React.FC<SettingComponentProps> = ({
  disabled,
}) => {
  const { t } = useLingui();
  const globalSettings = useStore((s) => s.globalSettings);
  const updateGlobalSettings = useStore((s) => s.updateGlobalSettings);
  const {
    devices,
    needsPermission,
    requesting,
    permissionError,
    requestAccess,
  } = useDeviceAccess("audioinput");

  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const mountedRef = useRef(true);
  const genRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const release = useCallback(() => {
    genRef.current++;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (mountedRef.current) setMicLevel(0);
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      release();
      const generation = genRef.current;
      const settings = useStore.getState().globalSettings;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(settings, deviceId),
        });
      } catch (err) {
        if (generation === genRef.current && mountedRef.current) {
          setMicError(describeMediaError(err));
        }
        return;
      }
      if (generation !== genRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      if (mountedRef.current) setMicError(null);
      try {
        const AudioCtxCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtxCtor();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (const v of data) sum += v;
          if (mountedRef.current) setMicLevel(sum / data.length / 255);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // The meter is a nice-to-have; the device picker still works without it.
      }
    },
    [release],
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
      void start(resolveDeviceId(globalSettings.callAudioInput, devices));
    }
  }, [devices, start, globalSettings.callAudioInput]);

  const handleChange = (deviceId: string) => {
    const device = devices.find((d) => d.deviceId === deviceId);
    updateGlobalSettings({
      callAudioInput: device
        ? { deviceId: device.deviceId, label: device.label }
        : null,
    });
    void start(deviceId || undefined);
  };

  const handleRequestAccess = async () => {
    const found = await requestAccess();
    void start(resolveDeviceId(globalSettings.callAudioInput, found));
  };

  const selectedId =
    resolveDeviceId(globalSettings.callAudioInput, devices) ?? "";

  return (
    <div className="space-y-3">
      <DeviceAccessGate
        needsPermission={needsPermission}
        requesting={requesting}
        error={permissionError}
        onRequestAccess={() => void handleRequestAccess()}
        disabled={disabled}
        message={
          <Trans>
            Device names are hidden until you allow microphone access.
          </Trans>
        }
        buttonLabel={<Trans>Allow microphone access</Trans>}
      />
      {!needsPermission &&
        (devices.length === 0 ? (
          <p className="text-xs text-discord-text-muted">
            <Trans>No microphone detected.</Trans>
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-discord-text-normal">
              <FaMicrophone className="h-4 w-4" />
              <Trans>Microphone</Trans>
            </div>
            <DeviceSelect
              devices={devices}
              value={selectedId}
              onChange={handleChange}
              disabled={disabled}
              labelFor={(d, i) => d.label || t`Microphone ${i + 1}`}
            />
            <div
              className="flex h-6 items-end gap-0.5"
              role="img"
              aria-label={t`Microphone level`}
            >
              {METER_BAR_HEIGHTS.map((height, i) => {
                const active = micLevel >= ((i + 1) / METER_BAR_COUNT) * 0.7;
                return (
                  <div
                    key={height}
                    className={`w-1.5 flex-1 rounded-sm transition-colors duration-75 ${
                      active ? "bg-discord-green" : "bg-discord-dark-400"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
          </>
        ))}
      {micError && <p className="text-xs text-red-400">{micError}</p>}
    </div>
  );
};

export default CallMicrophoneField;
