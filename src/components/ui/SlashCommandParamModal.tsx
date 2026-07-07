// Param-collection modal opened when a user selects a slash command
// from the SlashCommandPopover and that command declares any
// `options[]`.  Renders one form field per option, typed by
// `option.type`:
//
//   string             text input
//   int / number       numeric input (step=1 for int, any for number)
//   bool               checkbox
//   user               combobox of channel members + DM partner
//   channel            combobox of joined channels
//   date / time /
//   datetime           native date/time picker
//   country            select w/ flag + name; wire value is ISO-2 code
//   password           masked text input
//   * with choices[]   select of the bot-declared choices
//
// On submit the modal builds an options-map and calls sendBotCommand
// directly -- bypassing the freeform-args parser in useMessageSending.

import { Trans, t } from "@lingui/macro";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendBotCommand } from "../../hooks/useMessageSending";
import { COUNTRIES, flagEmoji } from "../../lib/countries";
import type {
  BotCommand,
  BotCommandOption,
  Channel,
  PrivateChat,
} from "../../types";

interface Props {
  serverId: string;
  botNick: string;
  command: BotCommand;
  channel: Channel | null;
  privateChat: PrivateChat | null;
  /** Members from the active channel so the "user" type can
   *  autocomplete against people who are reachable right now. */
  channelMembers: string[];
  /** Channel names the user has joined for the "channel" type. */
  joinedChannels: string[];
  onClose: () => void;
}

export const SlashCommandParamModal: React.FC<Props> = ({
  serverId,
  botNick,
  command,
  channel,
  privateChat,
  channelMembers,
  joinedChannels,
  onClose,
}) => {
  const opts = command.options ?? [];
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const o of opts) {
      if (o.type === "bool") init[o.name] = false;
      else if (o.type === "int" || o.type === "number") init[o.name] = "";
      else init[o.name] = "";
    }
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(
    null,
  );

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Allow Escape to dismiss; Enter on a non-textarea submits.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onKey]);

  const setVal = (name: string, v: string | number | boolean) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required + coerce numerics; drop empty optional fields
    // so the bot sees them as absent rather than empty string.
    const payload: Record<string, string | number | boolean> = {};
    for (const o of opts) {
      const raw = values[o.name];
      const empty =
        raw === "" || raw === undefined || raw === null || raw === false;
      if (o.required && empty && o.type !== "bool") {
        setError(t`${o.name} is required.`);
        return;
      }
      if (raw === "" || raw === undefined || raw === null) continue;
      if (o.type === "int") {
        const n = Number.parseInt(String(raw), 10);
        if (Number.isNaN(n)) {
          setError(t`${o.name} must be a whole number.`);
          return;
        }
        payload[o.name] = n;
      } else if (o.type === "number") {
        const n = Number.parseFloat(String(raw));
        if (Number.isNaN(n)) {
          setError(t`${o.name} must be a number.`);
          return;
        }
        payload[o.name] = n;
      } else if (o.type === "bool") {
        payload[o.name] = Boolean(raw);
      } else {
        payload[o.name] = String(raw);
      }
    }
    sendBotCommand(serverId, channel, botNick, command, payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 px-4">
      <form
        onSubmit={submit}
        className="bg-discord-dark-200 rounded-lg w-full max-w-md p-5 max-h-[85vh] flex flex-col"
      >
        <div className="flex justify-between items-start mb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">
              /{command.name}
              <span className="text-discord-text-muted ml-1 text-sm">
                @{botNick}
              </span>
            </h2>
            {command.description && (
              <p className="text-xs text-discord-text-muted mt-1">
                {command.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-discord-text-muted hover:text-white ml-2"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0 pr-1">
          {opts.map((o, idx) => (
            <ParamField
              key={o.name}
              option={o}
              value={values[o.name]}
              setValue={(v) => setVal(o.name, v)}
              channelMembers={channelMembers}
              joinedChannels={joinedChannels}
              privateChatNick={privateChat?.username}
              autoFocusRef={idx === 0 ? firstFieldRef : undefined}
            />
          ))}
          {opts.length === 0 && (
            <p className="text-xs text-discord-text-muted">
              <Trans>This command takes no parameters.</Trans>
            </p>
          )}
        </div>
        {error && (
          <p className="text-discord-red text-xs mt-3 flex-shrink-0">{error}</p>
        )}
        <div className="flex justify-end gap-2 mt-4 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded bg-discord-dark-400 text-discord-text-normal hover:text-white text-sm"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="submit"
            className="px-3 py-2 rounded bg-discord-primary text-white text-sm font-medium"
          >
            <Trans>Run</Trans>
          </button>
        </div>
      </form>
    </div>
  );
};

interface ParamFieldProps {
  option: BotCommandOption;
  value: string | number | boolean;
  setValue: (v: string | number | boolean) => void;
  channelMembers: string[];
  joinedChannels: string[];
  privateChatNick: string | undefined;
  autoFocusRef?:
    | React.RefObject<HTMLInputElement | HTMLSelectElement | null>
    | undefined;
}

const BASE_INPUT =
  "w-full px-3 py-2 rounded bg-discord-dark-400 text-white text-sm placeholder:text-discord-text-muted/60 focus:outline-none focus:ring-1 focus:ring-discord-primary";

const ParamField: React.FC<ParamFieldProps> = ({
  option,
  value,
  setValue,
  channelMembers,
  joinedChannels,
  privateChatNick,
  autoFocusRef,
}) => {
  // Bot-declared `choices` override the type renderer with a select.
  const renderChoices = useMemo(() => {
    if (!option.choices?.length) return null;
    return (
      <select
        ref={autoFocusRef as React.RefObject<HTMLSelectElement | null>}
        className={BASE_INPUT}
        value={String(value ?? "")}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">—</option>
        {option.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }, [option.choices, value, setValue, autoFocusRef]);

  let field: React.ReactNode;
  if (renderChoices) {
    field = renderChoices;
  } else {
    switch (option.type) {
      case "bool":
        field = (
          <label className="inline-flex items-center gap-2 text-sm text-discord-text-normal">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setValue(e.target.checked)}
              className="rounded bg-discord-dark-400 border-discord-dark-500"
            />
            <span>{option.description ?? option.name}</span>
          </label>
        );
        break;
      case "int":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="number"
            step="1"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
        break;
      case "number":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="number"
            step="any"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
        break;
      case "date":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="date"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
        break;
      case "time":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="time"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
        break;
      case "datetime":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="datetime-local"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
        break;
      case "password":
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="password"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
            autoComplete="new-password"
          />
        );
        break;
      case "country":
        field = (
          <select
            ref={autoFocusRef as React.RefObject<HTMLSelectElement | null>}
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          >
            <option value="">—</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {flagEmoji(c.code)} {c.name} ({c.code})
              </option>
            ))}
          </select>
        );
        break;
      case "user": {
        const choices = Array.from(
          new Set(
            [...channelMembers, ...(privateChatNick ? [privateChatNick] : [])]
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b)),
          ),
        );
        const listId = `param-users-${option.name}`;
        field = (
          <>
            <input
              ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
              type="text"
              value={String(value ?? "")}
              onChange={(e) => setValue(e.target.value)}
              className={BASE_INPUT}
              placeholder={t`nick`}
              list={listId}
              autoComplete="off"
            />
            <datalist id={listId}>
              {choices.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </>
        );
        break;
      }
      case "channel": {
        const listId = `param-channels-${option.name}`;
        field = (
          <>
            <input
              ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
              type="text"
              value={String(value ?? "")}
              onChange={(e) => setValue(e.target.value)}
              className={BASE_INPUT}
              placeholder={t`#channel`}
              list={listId}
              autoComplete="off"
            />
            <datalist id={listId}>
              {joinedChannels.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        );
        break;
      }
      default:
        field = (
          <input
            ref={autoFocusRef as React.RefObject<HTMLInputElement | null>}
            type="text"
            value={String(value ?? "")}
            onChange={(e) => setValue(e.target.value)}
            className={BASE_INPUT}
          />
        );
    }
  }

  return (
    <div>
      <label className="text-sm text-white block mb-1">
        {option.name}
        {option.required && (
          <span className="text-discord-red ml-1 text-xs">
            <Trans>required</Trans>
          </span>
        )}
        <span className="text-discord-text-muted ml-2 text-xs uppercase tracking-wide">
          {option.type ?? "string"}
        </span>
      </label>
      {field}
      {option.description && option.type !== "bool" && (
        <p className="text-xs text-discord-text-muted mt-1">
          {option.description}
        </p>
      )}
    </div>
  );
};

export default SlashCommandParamModal;
