import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { FaVolumeUp } from "react-icons/fa";
import {
  resolveDeviceId,
  speakerSelectionSupported,
} from "../../../lib/mediaDevices";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";
import { DeviceAccessGate, DeviceSelect } from "./CallDeviceShared";
import { useDeviceAccess } from "./useDeviceAccess";

/** Speaker picker. Reading the output device list needs no capture of its
 *  own, so unlike its microphone and camera siblings this field never opens
 *  or releases a device -- it only saves which output id/label a call
 *  should use. */
export const CallSpeakerField: React.FC<SettingComponentProps> = ({
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
  } = useDeviceAccess("audiooutput");

  if (!speakerSelectionSupported()) {
    return (
      <p className="text-xs text-discord-text-muted">
        <Trans>Speaker selection isn't supported in this browser.</Trans>
      </p>
    );
  }

  const handleChange = (deviceId: string) => {
    const device = devices.find((d) => d.deviceId === deviceId);
    updateGlobalSettings({
      callAudioOutput: device
        ? { deviceId: device.deviceId, label: device.label }
        : null,
    });
  };

  const selectedId =
    resolveDeviceId(globalSettings.callAudioOutput, devices) ?? "";

  return (
    <div className="space-y-3">
      <DeviceAccessGate
        needsPermission={needsPermission}
        requesting={requesting}
        error={permissionError}
        onRequestAccess={() => void requestAccess()}
        disabled={disabled}
        message={
          <Trans>
            Browsers only reveal your speakers once you have allowed access to a
            microphone or camera. Nothing is recorded.
          </Trans>
        }
        buttonLabel={<Trans>Show my speakers</Trans>}
      />
      {!needsPermission &&
        (devices.length === 0 ? (
          <p className="text-xs text-discord-text-muted">
            <Trans>No speaker detected.</Trans>
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-discord-text-normal">
              <FaVolumeUp className="h-4 w-4" />
              <Trans>Speaker</Trans>
            </div>
            <DeviceSelect
              devices={devices}
              value={selectedId}
              onChange={handleChange}
              disabled={disabled}
              labelFor={(d, i) => d.label || t`Speaker ${i + 1}`}
            />
          </>
        ))}
    </div>
  );
};

export default CallSpeakerField;
