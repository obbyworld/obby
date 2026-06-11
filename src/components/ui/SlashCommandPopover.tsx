// Slash-command suggestion popover, anchored above the chat input.
//
// Three sources feed into this:
//   * client → commands handled locally by the React app before they
//     touch the wire (e.g. /me, /msg, /nick).  Defined in
//     src/lib/clientCommands.ts; rendered with a "client" badge.
//   * server → obsidianirc/cmdslist capability — the IRCd's set of
//     commands the user is currently permitted to invoke (e.g. /op,
//     /kick, /mode); rendered with a "server" badge.
//   * bot → draft/bot-cmds — per-bot schemas with descriptions,
//     options, scope.  "channel-bot" or "server-bot" badge.
//
// Below the command name we show the description and a `<required>` /
// `[optional]` parameter signature.  Once the user accepts a
// suggestion and starts typing arguments, the popover yields to the
// param-hint footer (see SlashParamHint).
//
// Keyboard:
//   ArrowUp / ArrowDown -- cycle highlighted suggestion
//   Tab / Enter         -- accept current suggestion
//   Escape              -- close
//
// onSelect receives the bare command name (without the leading slash).

import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BotCommandOption } from "../../types";

export type SlashSuggestionSource =
  | { kind: "client" }
  | { kind: "server" }
  | { kind: "bot"; botNick: string; scope?: "channel" | "server" };

export interface SlashSuggestion {
  name: string;
  description?: string;
  options?: BotCommandOption[];
  source: SlashSuggestionSource;
}

interface SlashCommandPopoverProps {
  isVisible: boolean;
  inputValue: string;
  commands: SlashSuggestion[];
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null;
  onSelect: (suggestion: SlashSuggestion) => void;
  onClose: () => void;
}

const MAX_SUGGESTIONS = 10;

export function getActiveSlashQuery(
  inputValue: string,
  cursorPosition: number,
): string | null {
  // Only active when the input starts with a single "/" and the user
  // has not yet typed a space (still completing the command name).
  if (!inputValue.startsWith("/")) return null;
  if (inputValue.startsWith("//")) return null; // escape for literal "/"
  const beforeCursor = inputValue.slice(0, cursorPosition);
  const firstSpace = beforeCursor.indexOf(" ");
  if (firstSpace !== -1) return null;
  return beforeCursor.slice(1).toLowerCase();
}

/** Compact "name <required> [optional]" rendering of an option list. */
export function formatOptions(options: BotCommandOption[] | undefined): string {
  if (!options || options.length === 0) return "";
  return options
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(" ");
}

interface BadgeStyle {
  label: string;
  title: string;
  className: string;
}

function badgeStyle(
  source: SlashSuggestionSource,
  t: ReturnType<typeof useLingui>["t"],
): BadgeStyle {
  switch (source.kind) {
    case "client":
      return {
        label: t`client`,
        title: t`Handled by ObsidianIRC before being sent`,
        className:
          "bg-discord-dark-200 text-discord-text-muted border border-discord-dark-500",
      };
    case "server":
      return {
        label: t`server`,
        title: t`Command provided by the IRC server`,
        className:
          "bg-emerald-700/40 text-emerald-300 border border-emerald-600/60",
      };
    case "bot":
      return source.scope === "server"
        ? {
            // Sky instead of brand purple: the selected-row highlight
            // is bg-discord-primary, and the old purple badge tint
            // disappeared against it.  Sky still reads as "network-
            // wide service" and stays legible on both backgrounds.
            label: t`server-bot`,
            title: t`Server-wide bot — reachable from any channel`,
            className: "bg-sky-700/40 text-sky-300 border border-sky-600/60",
          }
        : {
            label: t`channel-bot`,
            title: t`Channel bot — present in this channel`,
            className:
              "bg-amber-700/30 text-amber-300 border border-amber-600/50",
          };
  }
}

function sourceBadge(
  source: SlashSuggestionSource,
  t: ReturnType<typeof useLingui>["t"],
): React.ReactNode {
  const { label, title, className } = badgeStyle(source, t);
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${className}`}
      title={title}
    >
      {label}
    </span>
  );
}

export const SlashCommandPopover: React.FC<SlashCommandPopoverProps> = ({
  isVisible,
  inputValue,
  commands,
  inputElement,
  onSelect,
  onClose,
}) => {
  const { t } = useLingui();
  const cursorPosition = inputElement?.selectionStart ?? inputValue.length;
  const query = getActiveSlashQuery(inputValue, cursorPosition);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [] as SlashSuggestion[];
    if (commands.length === 0) return [];
    return commands
      .filter((c) => c.name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [commands, query]);

  // Reset highlight when the match set changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: matches identity changes drive the reset
  useEffect(() => {
    setSelectedIndex(0);
  }, [matches.length, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isVisible || matches.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => (i + 1) % matches.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => (i === 0 ? matches.length - 1 : i - 1));
          break;
        case "Tab":
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (matches[selectedIndex]) onSelect(matches[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isVisible, matches, selectedIndex, onSelect, onClose]);

  if (!isVisible || query === null || matches.length === 0) return null;

  // Pin the popover's bottom edge to the input's top edge (small 6px
  // gap) and its left edge to the input's left edge.  Using `bottom`
  // instead of `top + computed height` means the popover stays
  // correctly anchored regardless of how many rows it currently has
  // or whether any rows carry a description -- no row-height estimate
  // needed.
  const inputRect = inputElement?.getBoundingClientRect();
  // Refuse to render until the input has a real position on screen --
  // otherwise the first frame shows the popover anchored at viewport
  // (100, 100) for a flash before the ref resolves and it snaps to
  // the input.
  if (!inputRect || inputRect.height === 0) return null;
  const bottom = window.innerHeight - inputRect.top + 6;
  const left = inputRect.left;

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-discord-dark-300 border border-discord-dark-500 rounded-md shadow-xl min-w-72 max-w-lg"
      style={{ bottom, left }}
    >
      <div className="py-1 max-h-72 overflow-y-auto">
        <div className="px-3 py-1 text-xs text-discord-text-muted font-semibold uppercase tracking-wide border-b border-discord-dark-500">
          <Trans>Slash commands</Trans>
        </div>
        {matches.map((cmd, index) => {
          const sig = formatOptions(cmd.options);
          const isSelected = index === selectedIndex;
          return (
            <div
              key={`${cmd.source.kind}:${cmd.source.kind === "bot" ? cmd.source.botNick : ""}:${cmd.name}`}
              data-cmd-index={index}
              className={`px-3 py-1.5 cursor-pointer flex flex-col gap-0.5 transition-colors duration-150 ${
                isSelected
                  ? "bg-discord-primary text-white"
                  : "text-discord-text-normal hover:bg-discord-dark-200 hover:text-white"
              }`}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm">
                  /{cmd.name}
                  {sig && (
                    <span
                      className={`ml-1 font-mono text-xs ${isSelected ? "text-white/70" : "text-discord-text-muted"}`}
                    >
                      {sig}
                    </span>
                  )}
                </span>
                {sourceBadge(cmd.source, t)}
                {cmd.source.kind === "bot" && (
                  <span
                    className={`text-xs ${isSelected ? "text-white/70" : "text-discord-text-muted"}`}
                  >
                    @{cmd.source.botNick}
                  </span>
                )}
              </div>
              {cmd.description && (
                <div
                  className={`text-xs ${isSelected ? "text-white/85" : "text-discord-text-muted"}`}
                >
                  {cmd.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SlashCommandPopover;
