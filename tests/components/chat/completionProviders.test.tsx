import { describe, expect, it, vi } from "vitest";
import {
  type EmojiItem,
  emojiProvider,
  getActiveSlashQuery,
  nickProvider,
  type SlashSuggestion,
  slashProvider,
  slashSuggestions,
  typedBotCommand,
} from "../../../src/components/chat/completionProviders";
import type { CompletionProvider } from "../../../src/hooks/useCompletion";
import type { Channel, Server, User } from "../../../src/types";

const users: User[] = [
  { id: "1", username: "alice", isOnline: true },
  { id: "2", username: "bob", isOnline: true },
  { id: "3", username: "Bobby", isOnline: false },
  { id: "4", username: "admin", isOnline: true },
];

function complete<T>(
  provider: CompletionProvider<T>,
  text: string,
  caret = text.length,
) {
  const range = provider.match(text, caret);
  if (!range) return null;
  const items = provider.getItems(range.query);
  if (items.length === 0) return null;
  const replacement = provider.accept(items[0], range, text);
  return `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
}

describe("nickProvider", () => {
  const nicks = nickProvider(users);

  it("adds a colon at the start of the message and a space mid-message", () => {
    expect(complete(nicks, "ali")).toBe("alice: ");
    expect(complete(nicks, "   ali")).toBe("   alice: ");
    expect(complete(nicks, "hey alice, tell bo")).toBe("hey alice, tell bob ");
  });

  it("completes only the part of the word before the caret", () => {
    expect(complete(nicks, "alice", 3)).toBe("alice: ce");
  });

  it("sorts case-insensitively and skips a nick typed out in full", () => {
    expect(nicks.getItems("BOB").map((u) => u.username)).toEqual(["Bobby"]);
    expect(nicks.getItems("bo").map((u) => u.username)).toEqual([
      "bob",
      "Bobby",
    ]);
    expect(nicks.getItems("a").map((u) => u.username)).toEqual([
      "admin",
      "alice",
    ]);
  });

  it("offers nothing on an empty word and every member for the picker", () => {
    expect(nicks.match("hello ", 6)).toBeNull();
    expect(nicks.getItems("")).toHaveLength(users.length);
  });
});

describe("emojiProvider", () => {
  const emojis: EmojiItem[] = [
    {
      unified: "1f600",
      short_names: ["grinning"],
      category: "Smileys",
      emoji: "😀",
    },
    {
      unified: "custom-p-party",
      short_names: ["party"],
      category: "Custom",
      emoji: ":party:",
      imageUrl: "https://example.test/party.png",
    },
  ];
  const provider = emojiProvider(emojis);

  it("replaces the :word before the caret with the emoji", () => {
    expect(complete(provider, "hi :grin")).toBe("hi 😀");
    expect(complete(provider, "hi :par")).toBe("hi :party:");
  });

  it("claims a bare colon so Tab never falls through to nicks", () => {
    expect(provider.match("hi :", 4)).toEqual({ query: "", start: 3, end: 4 });
    expect(provider.getItems("")).toEqual([]);
  });
});

describe("slashProvider", () => {
  const commands: SlashSuggestion[] = [
    { name: "join", source: { kind: "client" } },
    { name: "roll", source: { kind: "bot", botNick: "dice" } },
    {
      name: "forecast",
      options: [{ name: "city", required: true }],
      source: { kind: "bot", botNick: "weather" },
    },
  ];

  it("matches only while the command name is typed", () => {
    expect(getActiveSlashQuery("/Jo", 3)).toBe("jo");
    expect(getActiveSlashQuery("/join #a", 8)).toBeNull();
    expect(getActiveSlashQuery("//join", 6)).toBeNull();
    expect(getActiveSlashQuery("hi /join", 8)).toBeNull();
  });

  it("fills the whole input, routing bot commands to their bot", () => {
    const provider = slashProvider(commands, vi.fn());
    expect(complete(provider, "/jo")).toBe("/join ");
    expect(complete(provider, "/ro")).toBe("/roll@dice ");
  });

  it("hands bot commands with options to the param form", () => {
    const onPickWithOptions = vi.fn();
    const provider = slashProvider(commands, onPickWithOptions);
    const range = { query: "fo", start: 0, end: 3 };
    expect(provider.accept(commands[2], range, "/fo")).toBeUndefined();
    expect(onPickWithOptions).toHaveBeenCalledWith(commands[2]);
  });
});

describe("slashSuggestions", () => {
  const channel = {
    users: [{ id: "h", username: "HelpBot", isOnline: true }],
  } as Channel;
  const server = {
    botCommands: {
      helpbot: [{ name: "help" }],
      dicebot: [{ name: "roll" }],
      away: [{ name: "ping" }],
    },
    bots: { dicebot: { scope: "server" } },
    cmdsAvailable: ["HELP", "kick", "roll"],
  } as unknown as Server;

  it("lists server commands ahead of channel bots present here and server bots anywhere", () => {
    const names = slashSuggestions(server, channel)
      .filter((s) => s.source.kind !== "client")
      .map((s) => `${s.source.kind}:${s.name}`);
    expect(names).toEqual([
      "server:HELP",
      "server:kick",
      "server:roll",
      "bot:roll",
      "bot:help",
    ]);
  });

  it("lists a network bot ahead of a directory channel bot ahead of any other bot", () => {
    const here = {
      users: ["plain", "listed", "network"].map((username) => ({
        id: username,
        username,
        isOnline: true,
      })),
    } as Channel;
    const ranked = {
      botCommands: {
        plain: [{ name: "pkg" }],
        listed: [{ name: "pkg" }],
        network: [{ name: "pkg" }],
      },
      bots: {
        plain: { bot_id: "draft-bot-cmds:plain", scope: "channel" },
        listed: { bot_id: "7", scope: "channel" },
        network: { bot_id: "9", scope: "server" },
      },
    } as unknown as Server;
    const bots = slashSuggestions(ranked, here)
      .filter((s) => s.source.kind === "bot")
      .map((s) => (s.source.kind === "bot" ? s.source.botNick : ""));
    expect(bots).toEqual(["network", "listed", "plain"]);
  });

  it("drops channel bots and channel-only client commands outside a channel", () => {
    const outside = slashSuggestions(server, undefined);
    expect(outside.some((s) => s.name === "help")).toBe(false);
    expect(outside.some((s) => s.name === "whisper")).toBe(false);
    expect(
      slashSuggestions(server, channel).some((s) => s.name === "whisper"),
    ).toBe(true);
  });
});

describe("typedBotCommand", () => {
  const pkg = (botNick: string): SlashSuggestion => ({
    name: "pkg",
    options: [{ name: "repo", required: true }],
    source: { kind: "bot", botNick },
  });

  it("finds the bot command once a space follows its name", () => {
    expect(typedBotCommand("/pkg ", 5, [pkg("cloudbot")])?.source).toEqual({
      kind: "bot",
      botNick: "cloudbot",
    });
    expect(typedBotCommand("/pkg", 4, [pkg("cloudbot")])).toBeNull();
    expect(typedBotCommand("/pkg x", 6, [pkg("cloudbot")])).toBeNull();
  });

  it("takes the first-listed bot unless the bot is named", () => {
    const both = [pkg("a"), pkg("b")];
    expect(typedBotCommand("/pkg ", 5, both)?.source).toEqual({
      kind: "bot",
      botNick: "a",
    });
    expect(typedBotCommand("/pkg@B ", 7, both)?.source).toEqual({
      kind: "bot",
      botNick: "b",
    });
  });

  it("leaves a bare name the server offers to the server", () => {
    const server: SlashSuggestion = { name: "pkg", source: { kind: "server" } };
    expect(typedBotCommand("/pkg ", 5, [server, pkg("a")])).toBeNull();
    expect(typedBotCommand("/pkg@a ", 7, [server, pkg("a")])?.source).toEqual({
      kind: "bot",
      botNick: "a",
    });
  });

  it("leaves client commands to the client", () => {
    const me: SlashSuggestion = { name: "pkg", source: { kind: "client" } };
    expect(typedBotCommand("/pkg ", 5, [me, pkg("a")])).toBeNull();
  });
});
