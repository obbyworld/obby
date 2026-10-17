import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import type {
  CommandArgError,
  CommandArgValues,
} from "../../lib/commandInvocation";
import { keepInputFocus } from "../../lib/focus";
import type { BotCommand, BotCommandOption } from "../../types";
import { CloseButton } from "../ui/CloseButton";

export const COMMAND_DETAIL_ID = "command-args-detail";

export interface CommandArgsStripProps {
  command: BotCommand;
  params: BotCommandOption[];
  active: number;
  values: CommandArgValues;
  hiddenCount: number;
  error?: CommandArgError;
  onSelect: (index: number) => void;
  onAddOption: () => void;
  onCancel: () => void;
}

export const CommandArgsStrip: React.FC<CommandArgsStripProps> = ({
  command,
  params,
  active,
  values,
  hiddenCount,
  error,
  onSelect,
  onAddOption,
  onCancel,
}) => {
  const { t } = useLingui();
  const isTouch = useIsTouchInput();
  const target = isTouch ? "h-11 min-w-11" : "h-7";
  const current = params[active];
  const errorText = (e: CommandArgError) => {
    if (e.kind === "required") return t`${e.name} is required`;
    if (e.kind === "int") return t`${e.name} must be a whole number`;
    return t`${e.name} must be a number`;
  };
  const detail = error
    ? errorText(error)
    : (current?.description ?? command.description);

  return (
    <div className="flex min-w-0 w-full overflow-hidden rounded-t-lg border-b border-white/[0.06] bg-discord-dark-100">
      <div className="w-0.5 flex-shrink-0 rounded-l bg-discord-primary/70" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1">
        <span className="shrink-0 font-mono text-xs font-semibold text-discord-text-link">
          /{command.name}
        </span>
        <span
          className={`min-w-0 flex-1 basis-40 truncate text-xs ${error ? "text-discord-red" : "text-discord-text-muted"}`}
          id={COMMAND_DETAIL_ID}
          aria-live="polite"
          title={detail}
        >
          {detail}
        </span>
        <fieldset
          aria-label={t`Command options`}
          className="m-0 flex min-w-0 flex-wrap items-center gap-x-1 border-0 p-0 max-sm:basis-full"
        >
          {params.length > 1 &&
            params.map((p, i) => (
              <button
                key={p.name}
                type="button"
                onMouseDown={keepInputFocus}
                onClick={() => onSelect(i)}
                aria-pressed={i === active}
                className={`${target} flex items-center gap-1 rounded px-2 text-xs ${
                  i === active
                    ? "bg-discord-primary/25 text-discord-text-link"
                    : "text-discord-text-muted hover:bg-white/10"
                }`}
              >
                {p.name}
                {values[p.name] && i !== active && (
                  <>
                    <span className="size-1.5 rounded-full bg-discord-green" />
                    <span className="sr-only">
                      <Trans>has a value</Trans>
                    </span>
                  </>
                )}
              </button>
            ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onMouseDown={keepInputFocus}
              onClick={onAddOption}
              className={`${target} flex items-center rounded px-2 text-xs text-discord-text-muted hover:bg-white/10`}
            >
              <Trans>+{hiddenCount} options</Trans>
            </button>
          )}
        </fieldset>
      </div>
      <CloseButton label={t`Cancel command`} onClick={onCancel} />
    </div>
  );
};
