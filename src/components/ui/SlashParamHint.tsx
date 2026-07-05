// Inline hint shown above the chat input once the user has typed the
// command name and at least one space, e.g.
//
//   /forecast lon
//   ───────────────────────────────────────────────────
//   /forecast <city> — Look up the current weather for a city
//                ^^^ city (string, required)  via @weather
//
// The active parameter (the one the cursor is currently on) is bolded.
// Only fires for draft/bot-cmds commands -- builtin /op /me etc. don't
// publish a schema so there's nothing to hint about.

import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { BotCommand } from "../../types";

export interface SlashParamSchema {
  command: BotCommand;
  source: "client" | "bot";
  /** Present iff source === "bot" */
  botNick?: string;
  scope: "channel" | "server" | "dm";
}

interface SlashParamHintProps {
  inputValue: string;
  cursorPosition: number;
  /** Map of command name → schema, lowercased keys. */
  schemas: Record<string, SlashParamSchema>;
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null;
}

/** Returns { cmdName, argIndex } when the cursor is inside an arg
 *  position of `/<cmd> <arg0> <arg1> …`, otherwise null.
 *
 *  cmdName is the raw form (may include `@botnick`); the caller can
 *  look this up directly against a schemas map keyed by the same
 *  composite form, then fall back to the bare cmd if no specific
 *  entry exists. */
export function getActiveParamContext(
  input: string,
  cursor: number,
): { cmdName: string; argIndex: number } | null {
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  // Strip leading slash, find the command name (before first space).
  const head = input.slice(1);
  const firstSpace = head.indexOf(" ");
  if (firstSpace === -1) return null; // still typing the command name
  const cmdName = head.slice(0, firstSpace).toLowerCase();
  const bare = cmdName.includes("@") ? cmdName.split("@")[0] : cmdName;
  if (!bare) return null;

  // Cursor must be at or past the first space.
  const cursorInHead = cursor - 1;
  if (cursorInHead <= firstSpace) return null;

  // Count spaces in head[0..cursorInHead] to figure out which arg.
  let argIndex = -1; // -1 means still in cmd name region
  for (let i = 0; i <= cursorInHead && i < head.length; i++) {
    if (head[i] === " ") argIndex++;
  }
  if (argIndex < 0) return null;
  return { cmdName, argIndex };
}

export const SlashParamHint: React.FC<SlashParamHintProps> = ({
  inputValue,
  cursorPosition,
  schemas,
  inputElement,
}) => {
  // The parent only re-renders this hint when its own state changes
  // (and it intentionally avoids re-rendering on every keystroke for
  // perf reasons -- input value is held in a ref).  Subscribe to the
  // input element directly so the hint re-evaluates context on every
  // edit; only then will it correctly disappear when the user edits
  // the command name to something the schemas don't know about.
  const [liveValue, setLiveValue] = useState(inputValue);
  const [liveCursor, setLiveCursor] = useState(cursorPosition);

  useEffect(() => {
    if (!inputElement) return;
    const refresh = () => {
      setLiveValue(inputElement.value);
      setLiveCursor(inputElement.selectionStart ?? inputElement.value.length);
    };
    refresh();
    inputElement.addEventListener("input", refresh);
    inputElement.addEventListener("keyup", refresh);
    inputElement.addEventListener("click", refresh);
    return () => {
      inputElement.removeEventListener("input", refresh);
      inputElement.removeEventListener("keyup", refresh);
      inputElement.removeEventListener("click", refresh);
    };
  }, [inputElement]);

  // Keep parent-provided props as a fallback for the first render
  // before the listener has fired (and so unit tests that don't wire
  // an element still get the static read).
  const effValue = inputElement ? liveValue : inputValue;
  const effCursor = inputElement ? liveCursor : cursorPosition;

  const ctx = useMemo(
    () => getActiveParamContext(effValue, effCursor),
    [effValue, effCursor],
  );

  if (!ctx) return null;
  // Try `/cmd@bot` first, then fall back to the bare command name.
  const bare = ctx.cmdName.includes("@")
    ? ctx.cmdName.split("@")[0]
    : ctx.cmdName;
  const entry = schemas[ctx.cmdName] ?? schemas[bare];
  if (!entry) return null;

  const opts = entry.command.options ?? [];
  if (opts.length === 0) return null;

  // Position above the input, same anchor as the popover.
  const inputRect = inputElement?.getBoundingClientRect();
  const top = inputRect ? inputRect.top + window.scrollY - 70 : 100;
  const left = inputRect ? inputRect.left + window.scrollX : 100;

  return (
    <div
      className="fixed z-[9999] bg-discord-dark-300 border border-discord-dark-500 rounded-md shadow-xl px-3 py-2 min-w-72 max-w-lg text-sm"
      style={{ top, left }}
    >
      <div className="font-mono text-discord-text-normal">
        /{entry.command.name}{" "}
        {opts.map((o, i) => {
          const active = i === ctx.argIndex;
          const text = o.required ? `<${o.name}>` : `[${o.name}]`;
          return (
            <span
              key={o.name}
              className={
                active
                  ? "text-discord-text-link font-semibold"
                  : "text-discord-text-muted"
              }
            >
              {text}{" "}
            </span>
          );
        })}
        <span className="text-xs text-discord-text-muted ml-1">
          {entry.source === "bot" ? (
            <Trans>via @{entry.botNick}</Trans>
          ) : (
            <Trans>(handled by ObsidianIRC)</Trans>
          )}
        </span>
      </div>
      {opts[ctx.argIndex] && (
        <div className="mt-1 text-xs text-discord-text-muted">
          <span className="text-discord-text-normal font-medium">
            {opts[ctx.argIndex].name}
          </span>
          {" — "}
          <span>{opts[ctx.argIndex].type || "string"}</span>
          {opts[ctx.argIndex].required && (
            <span className="text-discord-red ml-1">
              <Trans>required</Trans>
            </span>
          )}
          {opts[ctx.argIndex].description && (
            <span className="ml-1">— {opts[ctx.argIndex].description}</span>
          )}
        </div>
      )}
      {/* show choices if present */}
      {(opts[ctx.argIndex]?.choices?.length ?? 0) > 0 && (
        <div className="mt-1 text-xs text-discord-text-muted">
          <Trans>one of:</Trans>{" "}
          <span className="font-mono text-discord-text-normal">
            {opts[ctx.argIndex].choices?.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
};

export default SlashParamHint;
