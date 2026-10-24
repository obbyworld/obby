import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageSending } from "../../src/hooks/useMessageSending";
import { base64DecodeUtf8 } from "../../src/lib/base64";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Channel, Server, User } from "../../src/types";

const bot = (username: string) => ({
  id: username,
  username,
  isOnline: true,
  isBot: true,
});

const channel = {
  id: "c1",
  name: "#lobby",
  users: [bot("_cloudbot"), bot("netbot")],
} as unknown as Channel;

const server = {
  id: "s1",
  name: "net",
  channels: [channel],
  privateChats: [],
  botCommands: {
    _cloudbot: [
      { name: "whois", options: [{ name: "domain", type: "string" }] },
      { name: "pkg" },
    ],
    netbot: [{ name: "pkg" }],
  },
  bots: {
    _cloudbot: { bot_id: "draft-bot-cmds:_cloudbot", scope: "channel" },
    netbot: { bot_id: "4", scope: "server" },
  },
  cmdsAvailable: ["whois"],
} as unknown as Server;

const me = { id: "me", username: "me", isOnline: true };

function runCommand(text: string, currentUser: User | null = null) {
  const { result } = renderHook(() =>
    useMessageSending({
      selectedServerId: "s1",
      selectedChannelId: "c1",
      selectedPrivateChatId: null,
      selectedChannel: channel,
      selectedPrivateChat: null,
      currentUser,
      selectedColor: null,
      selectedFormatting: [],
      localReplyTo: null,
    }),
  );
  result.current.sendMessage(text);
}

function sentBotCommand(sendRaw: ReturnType<typeof vi.spyOn>) {
  const line: string = sendRaw.mock.calls[0][1];
  const tag = /\+draft\/bot-cmd=(\S+)/.exec(line);
  return tag ? JSON.parse(base64DecodeUtf8(tag[1])) : null;
}

describe("slash commands shared by the server and bots", () => {
  beforeEach(() => {
    useStore.setState({ servers: [server] });
    vi.restoreAllMocks();
  });

  it("runs a bare name on the server", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    runCommand("/whois Valware");
    expect(sendRaw).toHaveBeenCalledWith("s1", "whois Valware");
  });

  it("sends the name to the bot it is addressed to", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    runCommand("/whois@_cloudbot example.com");
    expect(sentBotCommand(sendRaw)).toMatchObject({
      name: "whois",
      bot: "_cloudbot",
    });
  });

  it("sends a bare name two bots offer to the network bot", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    runCommand("/pkg");
    expect(sentBotCommand(sendRaw)).toMatchObject({
      name: "pkg",
      bot: "netbot",
    });
  });
});

describe("our own line on a server that echoes it", () => {
  const withCaps = (...caps: string[]) =>
    vi
      .spyOn(ircClient, "hasCapability")
      .mockImplementation((_, cap) => caps.includes(cap));
  const ownLines = () => useStore.getState().messages["s1-c1"] ?? [];

  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ servers: [server], messages: {} });
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows it as pending and marks it failed when no echo arrives", () => {
    withCaps("labeled-response", "echo-message", "batch");
    runCommand("hello", me);
    expect(ownLines()).toMatchObject([{ content: "hello", status: "pending" }]);

    vi.advanceTimersByTime(30_000);
    expect(ownLines()).toMatchObject([{ content: "hello", status: "failed" }]);
  });

  it("waits for the echo before it shows the line", () => {
    withCaps("echo-message");
    runCommand("hello", me);
    expect(ownLines()).toEqual([]);
  });
});

describe("/join", () => {
  beforeEach(() => {
    useStore.setState({ servers: [server] });
    (ircClient as unknown as { servers: Map<string, unknown> }).servers.set(
      "s1",
      { channels: [] },
    );
  });

  afterEach(() => {
    (ircClient as unknown as { servers: Map<string, unknown> }).servers.delete(
      "s1",
    );
    vi.restoreAllMocks();
  });

  it("sends each channel's key", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    runCommand("/join #secret,#open,#vault hunter2,,swordfish");
    const joins = sendRaw.mock.calls
      .map(([, line]) => line)
      .filter((line) => line.startsWith("JOIN"));
    expect(joins).toEqual([
      "JOIN #secret hunter2",
      "JOIN #open",
      "JOIN #vault swordfish",
    ]);
  });
});
