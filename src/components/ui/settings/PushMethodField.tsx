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

export const PushMethodField: React.FC<SettingComponentProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [isMissingDistributor, setIsMissingDistributor] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void pushStatus().then((loaded) => {
      if (!isCancelled) setStatus(loaded);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  const pickDistributor = async () => {
    const picked = await pickPushDistributor();
    setStatus(picked);
    setIsMissingDistributor(!picked.current);
    if (picked.current) onChange("unifiedpush");
  };

  const choose = (method: PushMethod) => {
    setIsMissingDistributor(false);
    if (method === "unifiedpush") void pickDistributor();
    else onChange(method);
  };

  const currentName = status?.distributors.find(
    (distributor) => distributor.id === status.current,
  )?.name;
  const options: {
    method: PushMethod;
    label: string;
    description: string;
    isUnavailable?: boolean;
  }[] = [
    {
      method: "fcm",
      label: t`Google (FCM)`,
      description:
        status?.isFcmAvailable === false
          ? t`Install Google Play services to use this`
          : t`Deliver right away through Google Play services`,
      isUnavailable: status?.isFcmAvailable === false,
    },
    {
      method: "unifiedpush",
      label: t`UnifiedPush`,
      description: t`Deliver right away through a distributor app you choose, such as ntfy`,
    },
    {
      method: "poll",
      label: t`Background check only`,
      description: t`Check for new messages about every 15 minutes`,
    },
  ];

  const unifiedPushDetails = isMissingDistributor ? (
    <p className="pl-7 text-[13px] text-discord-text-muted">
      <Trans>
        Install a UnifiedPush distributor such as ntfy, then select UnifiedPush
        again
      </Trans>
    </p>
  ) : (
    value === "unifiedpush" &&
    currentName && (
      <div className="flex items-center justify-between gap-3 pl-7">
        <span className="text-[13px] text-discord-text-muted">
          <Trans>Using {currentName}</Trans>
        </span>
        {status && status.distributors.length > 1 && (
          <button
            type="button"
            onClick={() => void pickDistributor()}
            disabled={disabled}
            className="min-h-11 rounded px-4 text-sm bg-discord-dark-400 text-discord-text-normal disabled:opacity-50"
          >
            <Trans>Choose distributor</Trans>
          </button>
        )}
      </div>
    )
  );

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <div key={option.method} className="flex flex-col gap-1">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="push-method"
              checked={value === option.method}
              onChange={() => choose(option.method)}
              disabled={disabled || option.isUnavailable}
              className="mt-1 accent-discord-primary disabled:opacity-50"
            />
            <span className="flex flex-col">
              <span className="text-sm text-discord-text-normal">
                {option.label}
              </span>
              <span className="text-[13px] text-discord-text-muted">
                {option.description}
              </span>
            </span>
          </label>
          {option.method === "unifiedpush" && unifiedPushDetails}
        </div>
      ))}
    </div>
  );
};
