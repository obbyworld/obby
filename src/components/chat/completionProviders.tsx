import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { CompletionProvider } from "../../hooks/useCompletion";
import { botPriority } from "../../lib/botPriority";
import { getClientCommands } from "../../lib/clientCommands";
import type { ResolvedShortcode } from "../../lib/customEmoji";
import type { BotCommandOption, Channel, Server, User } from "../../types";

const MAX_EMOJIS = 10;
const MAX_SLASH_COMMANDS = 10;
const CYCLE_KEYS = ["Tab"];
const SLASH_ACCEPT_KEYS = ["Tab", "Enter"];
const EMOJI_CLOSE_KEYS = ["Escape", " "];

export function nickProvider(users: readonly User[]): CompletionProvider<User> {
  return {
    title: <Trans>Members</Trans>,
    manual: true,
    quietFirstStep: true,
    cycleKeys: CYCLE_KEYS,
    match: (text, caret) => {
      const word = text.slice(0, caret).split(/\s+/).pop() ?? "";
      return word
        ? { query: word, start: caret - word.length, end: caret }
        : null;
    },
    getItems: (query) => {
      const needle = query.toLowerCase();
      return users
        .filter((user) => {
          const name = user.username.toLowerCase();
          return name.startsWith(needle) && name !== needle;
        })
        .sort((a, b) =>
          a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
        );
    },
    getKey: (user) => user.id,
    renderItem: (user) => (
      <>
        <span className="w-6 h-6 rounded-full bg-discord-dark-400 flex items-center justify-center text-xs text-white shrink-0">
          {user.username.charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 min-w-0 truncate">{user.username}</span>
        {user.isOnline && (
          <span className="w-2 h-2 rounded-full bg-discord-green shrink-0" />
        )}
      </>
    ),
    // IRC convention: "nick: " addresses someone at the start of a line.
    accept: (user, range, text) =>
      `${user.username}${text.slice(0, range.start).trim() ? " " : ": "}`,
  };
}

export interface EmojiItem {
  unified: string;
  short_names: string[];
  category: string;
  // A custom pack entry holds `:shortcode:` so the message renderer resolves
  // it through the pack's trusted image URL.
  emoji: string;
  imageUrl?: string;
}

interface RawEmojiData {
  unified: string;
  short_names: string[];
  category: string;
}

function toEmojiItem(raw: RawEmojiData): EmojiItem {
  return {
    unified: raw.unified,
    short_names: raw.short_names,
    category: raw.category,
    emoji: String.fromCodePoint(
      ...raw.unified.split("-").map((hex) => Number.parseInt(hex, 16)),
    ),
  };
}

// Custom pack shortcodes shadow Unicode emoji of the same name, since a
// network pack usually means to override them.
export function useEmojiItems(
  customShortcodes: readonly ResolvedShortcode[],
): EmojiItem[] {
  const [unicodeEmoji, setUnicodeEmoji] = useState<EmojiItem[]>([]);
  useEffect(() => {
    let isCurrent = true;
    import("virtual:emoji-slim")
      .then((m) => {
        if (isCurrent)
          setUnicodeEmoji((m.default as RawEmojiData[]).map(toEmojiItem));
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, []);

  return useMemo(() => {
    const custom = customShortcodes.map((sc) => ({
      unified: `custom-${sc.packId}-${sc.shortcode}`,
      short_names: [sc.shortcode],
      category: "Custom",
      emoji: `:${sc.shortcode}:`,
      imageUrl: sc.url,
    }));
    const customNames = new Set(
      custom.map((e) => e.short_names[0].toLowerCase()),
    );
    return [
      ...custom,
      ...unicodeEmoji.filter(
        (u) => !u.short_names.some((n) => customNames.has(n.toLowerCase())),
      ),
    ];
  }, [customShortcodes, unicodeEmoji]);
}

export function emojiProvider(
  emojis: readonly EmojiItem[],
): CompletionProvider<EmojiItem> {
  return {
    title: <Trans>Emojis</Trans>,
    manual: true,
    cycleKeys: CYCLE_KEYS,
    closeKeys: EMOJI_CLOSE_KEYS,
    match: (text, caret) => {
      const found = /:([a-zA-Z_]*)$/.exec(text.slice(0, caret));
      return found ? { query: found[1], start: found.index, end: caret } : null;
    },
    getItems: (query) => {
      if (!query) return [];
      const needle = query.toLowerCase();
      return emojis
        .filter((e) =>
          e.short_names.some((name) => name.toLowerCase().includes(needle)),
        )
        .slice(0, MAX_EMOJIS);
    },
    getKey: (item) => item.unified,
    renderItem: (item) => (
      <>
        <span className="w-6 h-6 shrink-0 flex items-center justify-center text-xl">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={`:${item.short_names[0]}:`}
              className="max-w-full max-h-full object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            item.emoji
          )}
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="truncate">:{item.short_names[0]}:</span>
          {item.short_names.length > 1 && (
            <span className="row-meta truncate">
              :{item.short_names.slice(1, 3).join(": :")}:
            </span>
          )}
        </span>
        <span className="row-meta shrink-0 capitalize">{item.category}</span>
      </>
    ),
    accept: (item) => item.emoji,
  };
}

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

// A leading "//" sends a literal slash, and a space ends the command name.
export function getActiveSlashQuery(
  inputValue: string,
  cursorPosition: number,
): string | null {
  if (!inputValue.startsWith("/") || inputValue.startsWith("//")) return null;
  const beforeCursor = inputValue.slice(0, cursorPosition);
  if (beforeCursor.includes(" ")) return null;
  return beforeCursor.slice(1).toLowerCase();
}

// `/name ` or `/name@bot ` with the caret after the space names the bot
// command the user wants to fill in. A bare name goes to the first bot listed,
// since slashSuggestions lists bots in the order they answer.
export function typedBotCommand(
  inputValue: string,
  cursorPosition: number,
  suggestions: readonly SlashSuggestion[],
): (SlashSuggestion & { source: { kind: "bot" } }) | null {
  const match = /^\/([^\s/@]+)(?:@(\S+))? $/.exec(inputValue);
  if (!match || cursorPosition !== inputValue.length) return null;
  const name = match[1].toLowerCase();
  const bot = match[2]?.toLowerCase();
  const named = suggestions.filter((s) => s.name.toLowerCase() === name);
  if (named.some((s) => s.source.kind === "client")) return null;
  if (!bot && named.some((s) => s.source.kind === "server")) return null;
  const bots = named.filter(
    (s): s is SlashSuggestion & { source: { kind: "bot" } } =>
      s.source.kind === "bot" &&
      (!bot || s.source.botNick.toLowerCase() === bot),
  );
  return bots[0] ?? null;
}

function formatOptions(options: BotCommandOption[] | undefined): string {
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
      return { label: t`client`, title: t`Command run by Obby` };
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

// Client commands come first because they own their names, then the server's
// cmdslist, then bot schemas by botPriority. A bare `/cmd` runs the first of
// these, so a bot behind it is picked as `/cmd@bot`.
export function slashSuggestions(
  server: Server | undefined,
  channel: Channel | undefined,
): SlashSuggestion[] {
  const suggestions: SlashSuggestion[] = [];
  const seen = new Set<string>();

  for (const c of getClientCommands()) {
    if (c.scope === "channel-only" && !channel) continue;
    suggestions.push({
      name: c.name,
      description: c.description,
      options: c.options,
      source: { kind: "client" },
    });
    seen.add(c.name.toLowerCase());
  }

  for (const name of server?.cmdsAvailable ?? []) {
    if (seen.has(name.toLowerCase())) continue;
    suggestions.push({ name, source: { kind: "server" } });
  }

  if (server?.botCommands) {
    const channelNicks = new Set(
      channel?.users.map((u) => u.username.toLowerCase()) ?? [],
    );
    const byPriority = Object.entries(server.botCommands).sort(
      ([a], [b]) =>
        botPriority(server.bots?.[a]) - botPriority(server.bots?.[b]),
    );
    for (const [botNick, list] of byPriority) {
      const scope = server.bots?.[botNick]?.scope ?? "channel";
      if (scope === "channel" && !channelNicks.has(botNick.toLowerCase()))
        continue;
      for (const c of list) {
        suggestions.push({
          name: c.name,
          description: c.description,
          options: c.options,
          source: { kind: "bot", botNick, scope },
        });
      }
    }
  }
  return suggestions;
}

export function slashProvider(
  commands: readonly SlashSuggestion[],
  onPickWithOptions: (suggestion: SlashSuggestion) => void,
): CompletionProvider<SlashSuggestion> {
  return {
    title: <Trans>Slash commands</Trans>,
    acceptKeys: SLASH_ACCEPT_KEYS,
    match: (text, caret) => {
      const query = getActiveSlashQuery(text, caret);
      return query === null ? null : { query, start: 0, end: text.length };
    },
    getItems: (query) =>
      commands
        .filter((c) => c.name.toLowerCase().startsWith(query))
        .slice(0, MAX_SLASH_COMMANDS),
    getKey: (cmd) =>
      `${cmd.source.kind}:${cmd.source.kind === "bot" ? cmd.source.botNick : ""}:${cmd.name}`,
    renderItem: (cmd) => {
      const signature = formatOptions(cmd.options);
      const source = sourceLabel(cmd.source);
      return (
        <span className="flex-1 min-w-0 flex flex-col gap-0.5 [[data-compact]_&]:flex-row [[data-compact]_&]:items-baseline [[data-compact]_&]:gap-2">
          <span className="flex items-baseline gap-2 min-w-0 [[data-compact]_&]:contents">
            <span className="truncate [[data-compact]_&]:shrink-0 [[data-compact]_&]:font-semibold">
              /{cmd.name}
            </span>
            {signature && (
              <span className="row-meta truncate [[data-compact]_&]:shrink-0">
                {signature}
              </span>
            )}
            <span
              className={`ml-auto shrink-0 [[data-compact]_&]:order-last ${
                cmd.source.kind === "server"
                  ? "rounded px-1.5 text-[11px] font-semibold uppercase bg-discord-primary text-white"
                  : "row-meta"
              }`}
              title={source.title}
            >
              {source.label}
            </span>
          </span>
          {cmd.description && (
            <span className="row-meta truncate [[data-compact]_&]:flex-1 [[data-compact]_&]:min-w-0">
              {cmd.description}
            </span>
          )}
        </span>
      );
    },
    accept: (cmd) => {
      if (cmd.source.kind !== "bot") return `/${cmd.name} `;
      if (cmd.options?.length) {
        onPickWithOptions(cmd);
        return;
      }
      return `/${cmd.name}@${cmd.source.botNick} `;
    },
  };
}
