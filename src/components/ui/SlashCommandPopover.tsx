// Slash-command suggestion popover, anchored above the chat input.
//
// Three sources feed into this:
//   * client → commands handled locally by the React app before they
//     touch the wire (e.g. /me, /msg, /nick).  Defined in
//     src/lib/clientCommands.ts; labelled "client".
//   * server → obsidianirc/cmdslist capability — the IRCd's set of
//     commands the user is currently permitted to invoke (e.g. /op,
//     /kick, /mode); labelled "server".
//   * bot → draft/bot-cmds — per-bot schemas with descriptions,
//     options, scope; labelled with the bot's nick.
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

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import type { BotCommandOption } from "../../types";
import SuggestionList from "./SuggestionList";

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

function sourceLabel(source: SlashSuggestionSource): {
  label: string;
  title: string;
} {
  switch (source.kind) {
    case "client":
      return { label: t`client`, title: t`Handled by Obby before being sent` };
    case "server":
      return {
        label: t`server`,
        title: t`Command provided by the IRC server`,
      };
    case "bot":
      return {
        label: `@${source.botNick}`,
        title:
          source.scope === "server"
            ? t`Server-wide bot, reachable from any channel`
            : t`Bot in this channel`,
      };
  }
}

const ACCEPT_KEYS = ["Tab", "Enter"];

export const SlashCommandPopover: React.FC<SlashCommandPopoverProps> = ({
  isVisible,
  inputValue,
  commands,
  inputElement,
  onSelect,
  onClose,
}) => {
  const cursorPosition = inputElement?.selectionStart ?? inputValue.length;
  const query = getActiveSlashQuery(inputValue, cursorPosition);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [] as SlashSuggestion[];
    return commands
      .filter((c) => c.name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [commands, query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new match set or query resets the highlight
  useEffect(() => {
    setSelectedIndex(0);
  }, [matches.length, query]);

  useSuggestionKeys({
    isActive: isVisible,
    count: matches.length,
    selectedIndex,
    onMove: setSelectedIndex,
    onAccept: (index) => {
      const match = matches[index];
      if (match) onSelect(match);
      return true;
    },
    onClose,
    acceptKeys: ACCEPT_KEYS,
  });

  if (!isVisible || query === null || matches.length === 0) return null;

  return (
    <SuggestionList
      title={<Trans>Slash commands</Trans>}
      items={matches}
      getKey={(cmd) =>
        `${cmd.source.kind}:${cmd.source.kind === "bot" ? cmd.source.botNick : ""}:${cmd.name}`
      }
      selectedIndex={selectedIndex}
      onHover={setSelectedIndex}
      onPick={onSelect}
      anchor={inputElement}
      className="min-w-72"
      renderItem={(cmd) => {
        const signature = formatOptions(cmd.options);
        const source = sourceLabel(cmd.source);
        return (
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="truncate">/{cmd.name}</span>
              {signature && (
                <span className="row-meta truncate">{signature}</span>
              )}
              <span className="row-meta ml-auto shrink-0" title={source.title}>
                {source.label}
              </span>
            </span>
            {cmd.description && (
              <span className="row-meta truncate">{cmd.description}</span>
            )}
          </span>
        );
      }}
    />
  );
};

export default SlashCommandPopover;
