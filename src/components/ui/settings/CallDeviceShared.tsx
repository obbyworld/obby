import { useLingui } from "@lingui/react/macro";
import type React from "react";
import type { ReactNode } from "react";
import { LoadingSpinner } from "../LoadingSpinner";

export const SELECT_CLASSES =
  "min-h-11 w-full rounded bg-discord-dark-400 px-3 py-2 text-discord-text-normal focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50";

interface DeviceAccessGateProps {
  needsPermission: boolean;
  requesting: boolean;
  error: string | null;
  onRequestAccess: () => void;
  disabled?: boolean;
  message: ReactNode;
  buttonLabel: ReactNode;
}

/** The "allow access" step shown while a device kind's labels are hidden,
 *  identical in every field except its wording. */
export const DeviceAccessGate: React.FC<DeviceAccessGateProps> = ({
  needsPermission,
  requesting,
  error,
  onRequestAccess,
  disabled,
  message,
  buttonLabel,
}) => {
  if (!needsPermission) return null;
  return (
    <div className="space-y-3 rounded-lg border border-discord-dark-400 bg-discord-dark-400/40 p-4">
      <p className="text-sm text-discord-text-normal">{message}</p>
      <button
        type="button"
        onClick={onRequestAccess}
        disabled={requesting || disabled}
        className="min-h-11 rounded bg-discord-primary px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
      >
        {requesting ? <LoadingSpinner size="xs" text="" /> : buttonLabel}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
};

interface DeviceSelectProps {
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  labelFor: (device: MediaDeviceInfo, index: number) => string;
}

export const DeviceSelect: React.FC<DeviceSelectProps> = ({
  devices,
  value,
  onChange,
  disabled,
  labelFor,
}) => {
  const { t } = useLingui();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={SELECT_CLASSES}
    >
      <option value="">{t`System default`}</option>
      {devices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {labelFor(d, i)}
        </option>
      ))}
    </select>
  );
};
