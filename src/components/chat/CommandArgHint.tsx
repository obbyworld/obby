import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import type { CommandArgError } from "../../lib/commandInvocation";
import type { BotCommandOption } from "../../types";
import { CloseButton } from "../ui/CloseButton";

export const COMMAND_DETAIL_ID = "command-args-detail";

export const CommandArgHint: React.FC<{
  param: BotCommandOption;
  fallback?: string;
  error?: CommandArgError;
  onCancel: () => void;
  ref?: React.Ref<HTMLDivElement>;
}> = ({ param, fallback, error, onCancel, ref }) => {
  const { t } = useLingui();
  const isTouch = useIsTouchInput();
  const errorText = (e: CommandArgError) => {
    if (e.kind === "required") return t`Fill in ${e.name}`;
    if (e.kind === "int") return t`Enter a whole number for ${e.name}`;
    return t`Enter a number for ${e.name}`;
  };
  const detail = error ? errorText(error) : (param.description ?? fallback);

  return (
    <div
      ref={ref}
      className="flex min-w-0 items-center rounded-t-lg border-b border-white/[0.06] bg-discord-dark-100 px-3 text-xs"
    >
      <span
        id={COMMAND_DETAIL_ID}
        aria-live="polite"
        className="min-w-0 flex-1 break-words py-1"
      >
        <span className="mr-2 font-semibold text-discord-text-normal">
          {param.name}
        </span>
        <span
          className={error ? "text-discord-red" : "text-discord-text-muted"}
        >
          {detail}
        </span>
      </span>
      {isTouch && <CloseButton label={t`Cancel command`} onClick={onCancel} />}
    </div>
  );
};
