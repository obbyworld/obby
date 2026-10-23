import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import {
  type PushStatus,
  pickPushDistributor,
  pushStatus,
} from "../../../lib/nativePush";
import type { SettingComponentProps } from "../../../lib/settings/types";
import type { PushMethod } from "../../../store/types";
import { type Segment, SegmentedControl } from "../SegmentedControl";

export const PushMethodField: React.FC<SettingComponentProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [isMissingDistributor, setIsMissingDistributor] = useState(false);
  const method = value as PushMethod;

  // We reload on return to the app, since the user leaves Obby to install ntfy.
  useEffect(() => {
    let isCancelled = false;
    const loadStatus = () => {
      if (document.visibilityState !== "visible") return;
      void pushStatus().then((loaded) => {
        if (isCancelled) return;
        setStatus(loaded);
        if (loaded.distributors.length > 0) setIsMissingDistributor(false);
      });
    };
    loadStatus();
    document.addEventListener("visibilitychange", loadStatus);
    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", loadStatus);
    };
  }, []);

  const pickDistributor = async () => {
    const picked = await pickPushDistributor();
    setStatus(picked);
    setIsMissingDistributor(!picked.current);
    if (picked.current) onChange("unifiedpush");
  };

  const choose = (next: PushMethod) => {
    setIsMissingDistributor(false);
    if (next === "unifiedpush") void pickDistributor();
    else onChange(next);
  };

  const segments: Segment<PushMethod>[] = [
    { value: "fcm", label: "Google" },
    { value: "unifiedpush", label: "UnifiedPush" },
    { value: "poll", label: t`Background` },
  ];
  const canChangeApp =
    method === "unifiedpush" && (status?.distributors.length ?? 0) > 1;

  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        segments={segments}
        value={method}
        onChange={choose}
        disabled={disabled}
        size="lg"
      />
      {isMissingDistributor && (
        <p className="text-[13px] text-discord-text-muted">
          <Trans>Install a UnifiedPush app first</Trans>
        </p>
      )}
      {canChangeApp && (
        <button
          type="button"
          onClick={() => void pickDistributor()}
          disabled={disabled}
          className="min-h-11 self-start text-sm text-discord-text-link disabled:opacity-50"
        >
          <Trans>Change app</Trans>
        </button>
      )}
    </div>
  );
};
