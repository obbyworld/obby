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

import type React from "react";
import { useMemo } from "react";
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
 *  position of `/<cmd> <arg0> <arg1> …`, otherwise null. */
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
  // Strip optional @botnick targeting suffix
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
  return { cmdName: bare, argIndex };
}

export const SlashParamHint: React.FC<SlashParamHintProps> = ({
  inputValue,
  cursorPosition,
  schemas,
  inputElement,
}) => {
  const ctx = useMemo(
    () => getActiveParamContext(inputValue, cursorPosition),
    [inputValue, cursorPosition],
  );

  if (!ctx) return null;
  const entry = schemas[ctx.cmdName];
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
          {entry.source === "bot"
            ? `via @${entry.botNick}`
            : "(handled by ObsidianIRC)"}
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
            <span className="text-discord-red ml-1">required</span>
          )}
          {opts[ctx.argIndex].description && (
            <span className="ml-1">— {opts[ctx.argIndex].description}</span>
          )}
        </div>
      )}
      {/* show choices if present */}
      {(opts[ctx.argIndex]?.choices?.length ?? 0) > 0 && (
        <div className="mt-1 text-xs text-discord-text-muted">
          one of:{" "}
          <span className="font-mono text-discord-text-normal">
            {opts[ctx.argIndex].choices?.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
};

export default SlashParamHint;
