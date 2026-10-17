import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import { jumpToMessage } from "../../src/lib/jumpToMessage";
import useStore from "../../src/store";
import {
  hasSavedChat,
  showSavedMessagesAround,
} from "../../src/store/handlers/history";
import type { Message } from "../../src/types";

vi.mock("../../src/store/handlers/history", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showSavedMessagesAround: vi.fn(),
  hasSavedChat: vi.fn(),
}));

const loadAround = vi.mocked(showSavedMessagesAround);
const hasSaved = vi.mocked(hasSavedChat);
const TIME = Date.parse("2026-01-01T12:00:00Z");

const message = (
  id: string,
  channelId: string,
  msgid: string | undefined = id,
  content = "hello",
  userId = "alice",
): Message =>
  ({
    id,
    msgid,
    type: "message",
    content,
    timestamp: new Date(TIME),
    userId,
    channelId,
    serverId: "server1",
    reactions: [],
    replyMessage: null,
    mentioned: [],
  }) as Message;

function setup(messages: Record<string, Message[]> = {}) {
  const state = useStore.getState();
  useStore.setState({
    servers: [
      {
        id: "server1",
        name: "TestNet",
        host: "irc.test",
        port: 6667,
        isConnected: true,
        users: [],
        channels: [
          {
            id: "chan1",
            name: "#General",
            isPrivate: false,
            serverId: "server1",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [],
          },
        ],
        privateChats: [],
      },
    ],
    messages,
    ui: {
      ...state.ui,
      selectedServerId: null,
      perServerSelections: {},
      messageJump: null,
    },
  } as never);
}

const selection = () =>
  useStore.getState().ui.perServerSelections.server1 ?? null;

describe("jumpToMessage", () => {
  beforeEach(() => {
    loadAround.mockReset();
    hasSaved.mockReset();
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue(null as never);
    vi.spyOn(ircClient, "getNick").mockReturnValue("me");
  });

  it("selects the chat and reveals a message already in memory", async () => {
    setup({ "server1-chan1": [message("internal-1", "chan1", "m1")] });

    const found = await jumpToMessage({
      serverId: "server1",
      target: "#general",
      msgid: "m1",
      time: TIME,
    });

    expect(found).toEqual({ ok: true });
    expect(useStore.getState().ui.selectedServerId).toBe("server1");
    expect(selection()?.selectedChannelId).toBe("chan1");
    expect(useStore.getState().ui.messageJump).toEqual({
      messageId: "internal-1",
    });
    expect(loadAround).not.toHaveBeenCalled();
  });

  it("loads the saved page around a message that is not in memory", async () => {
    setup();
    loadAround.mockImplementation(async () => {
      useStore.setState({
        messages: { "server1-chan1": [message("internal-2", "chan1", "m2")] },
      });
      return "loaded";
    });

    const found = await jumpToMessage({
      serverId: "server1",
      target: "#general",
      msgid: "m2",
      time: TIME,
    });

    expect(found).toEqual({ ok: true });
    expect(loadAround).toHaveBeenCalledWith(
      useStore,
      "server1",
      "#general",
      TIME,
    );
    expect(useStore.getState().ui.messageJump).toEqual({
      messageId: "internal-2",
    });
  });

  it("opens a saved private chat under the sender's own spelling", async () => {
    setup();
    hasSaved.mockResolvedValue(true);
    loadAround.mockResolvedValue("not-saved");

    await jumpToMessage({
      serverId: "server1",
      target: "bob",
      nick: "BoB",
      time: TIME,
    });

    const privateChat = useStore
      .getState()
      .servers[0].privateChats?.find((pc) => pc.username === "BoB");
    expect(privateChat).toBeDefined();
    expect(selection()?.selectedPrivateChatId).toBe(privateChat?.id);
  });

  it("opens no private chat without saved rows for it", async () => {
    setup();
    hasSaved.mockResolvedValue(false);

    const result = await jumpToMessage({
      serverId: "server1",
      target: "bob",
      time: TIME,
    });

    expect(result).toEqual({ ok: false, reason: "not-saved" });
    expect(useStore.getState().servers[0].privateChats).toEqual([]);
    expect(loadAround).not.toHaveBeenCalled();
  });

  it("reports a channel we left", async () => {
    setup();

    expect(
      await jumpToMessage({ serverId: "server1", target: "#old", time: TIME }),
    ).toEqual({ ok: false, reason: "left-channel" });
  });

  it("picks the line with the same text in a same millisecond burst", async () => {
    setup({
      "server1-chan1": [
        message("first", "chan1", undefined, "one"),
        message("second", "chan1", undefined, "two"),
      ],
    });

    await jumpToMessage({
      serverId: "server1",
      target: "#general",
      nick: "alice",
      text: "two",
      time: TIME,
    });

    expect(useStore.getState().ui.messageJump).toEqual({ messageId: "second" });
  });

  it("finds our own line under our current nick", async () => {
    setup({
      "server1-chan1": [message("mine", "chan1", undefined, "hi", "me")],
    });

    const result = await jumpToMessage({
      serverId: "server1",
      target: "#general",
      nick: "oldnick",
      text: "hi",
      time: TIME,
    });

    expect(result).toEqual({ ok: true });
    expect(useStore.getState().ui.messageJump).toEqual({ messageId: "mine" });
  });

  it("passes on why the saved rows could not show the message", async () => {
    setup();
    loadAround.mockResolvedValue("not-saved");

    const result = await jumpToMessage({
      serverId: "server1",
      target: "#general",
      msgid: "gone",
      time: TIME,
    });

    expect(result).toEqual({ ok: false, reason: "not-saved" });
    expect(useStore.getState().ui.messageJump).toBeNull();
  });
});
