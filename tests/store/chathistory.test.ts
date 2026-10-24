import { beforeEach, describe, expect, it, vi } from "vitest";
import { IRC_DISPATCH } from "../../src/lib/irc/handlers";
import type { IRCClientContext } from "../../src/lib/irc/IRCClientContext";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import {
  chathistoryBuffers,
  historyEditBuffers,
} from "../../src/store/handlers/batches";
import type { Channel, Message } from "../../src/types";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-1",
    name: "#test",
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [{ id: "alice-id", username: "alice", isOnline: true }],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    type: "message",
    content: "hello",
    timestamp: new Date("2026-01-01T12:00:00.000Z"),
    userId: "alice",
    channelId: "chan-1",
    serverId: "srv-1",
    reactions: [],
    replyMessage: null,
    mentioned: [],
    ...overrides,
  };
}

function setupServer() {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        ssl: false,
        channels: [makeChannel()],
        privateChats: [],
        isConnected: true,
        isConnecting: false,
        capabilities: ["draft/chathistory"],
      },
    ],
    messages: {},
    activeBatches: {},
  } as unknown as AppState);
}

describe("chathistory batch — PART events", () => {
  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
  });

  it("historical PART inside chathistory batch: member list unchanged, historical message created", () => {
    // Set up an active chathistory batch
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batch42: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });

    ircClient.triggerEvent("PART", {
      serverId: "srv-1",
      username: "alice",
      channelName: "#test",
      reason: "bye",
      batchTag: "batch42",
      time: "2026-01-01T11:00:00.000Z",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    // member list must not change — alice is still in the channel
    expect(channel?.users.some((u) => u.username === "alice")).toBe(true);
    // a historical part message is created with the server timestamp
    const msgs = useStore.getState().messages["srv-1-chan-1"] ?? [];
    const partMsgs = msgs.filter((m) => m.type === "part");
    expect(partMsgs).toHaveLength(1);
    expect(partMsgs[0].timestamp).toEqual(new Date("2026-01-01T11:00:00.000Z"));
  });

  it("processes PART normally when not inside a chathistory batch", () => {
    // No active batches
    ircClient.triggerEvent("PART", {
      serverId: "srv-1",
      username: "alice",
      channelName: "#test",
      reason: "",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    expect(channel?.users.some((u) => u.username === "alice")).toBe(false);
  });
});

describe("chathistory batch — NICK events", () => {
  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
  });

  it("historical NICK inside chathistory batch: member list unchanged, historical message created", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchNick: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });

    ircClient.triggerEvent("NICK", {
      serverId: "srv-1",
      mtags: { batch: "batchNick", time: "2026-01-01T11:00:00.000Z" },
      batchTag: "batchNick",
      oldNick: "alice",
      newNick: "alice2",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    // member list must not change — alice is still alice
    expect(channel?.users.some((u) => u.username === "alice")).toBe(true);
    expect(channel?.users.some((u) => u.username === "alice2")).toBe(false);
    // a historical nick message is created with the server timestamp
    const msgs = useStore.getState().messages["srv-1-chan-1"] ?? [];
    const nickMsgs = msgs.filter((m) => m.type === "nick");
    expect(nickMsgs).toHaveLength(1);
    expect(nickMsgs[0].timestamp).toEqual(new Date("2026-01-01T11:00:00.000Z"));
  });

  it("processes NICK normally when not in a chathistory batch", () => {
    ircClient.triggerEvent("NICK", {
      serverId: "srv-1",
      mtags: undefined,
      oldNick: "alice",
      newNick: "alice2",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    expect(channel?.users.some((u) => u.username === "alice2")).toBe(true);
    expect(channel?.users.some((u) => u.username === "alice")).toBe(false);
  });
});

describe("chathistory batch end — hasMoreHistory", () => {
  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
    useStore.setState({
      messages: {
        "srv-1-chan-1": [makeMessage()],
      },
    });
  });

  it("sets hasMoreHistory=true when batch had messages", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchH: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });
    chathistoryBuffers.set("batchH", [
      makeMessage({ id: "fetched-1", msgid: "fetched-1" }),
    ]);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchH",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    expect(channel?.hasMoreHistory).toBe(true);
  });

  it("sets hasMoreHistory=false when batch had no messages (reached beginning)", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchEmpty: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchEmpty",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    expect(channel?.hasMoreHistory).toBe(false);
  });

  it("sorts messages chronologically after batch ends", () => {
    const older = makeMessage({
      id: "old",
      msgid: "old",
      timestamp: new Date("2026-01-01T10:00:00.000Z"),
    });
    const newer = makeMessage({
      id: "new",
      msgid: "new",
      timestamp: new Date("2026-01-01T12:00:00.000Z"),
    });
    // newer is already in state; older arrives via the batch (out of chronological order)
    useStore.setState({
      messages: { "srv-1-chan-1": [newer] },
      activeBatches: {
        "srv-1": {
          batchSort: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });
    chathistoryBuffers.set("batchSort", [older]);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchSort",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    expect(msgs?.[0].id).toBe("old");
    expect(msgs?.[1].id).toBe("new");
  });
});

describe("chathistory batch — CHANMSG buffering", () => {
  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
    useStore.setState({
      processedMessageIds: new Set(),
    } as unknown as AppState);
  });

  it("CHANMSG with batch tag goes to buffer, not the store", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchCH: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });

    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "historical message",
      timestamp: new Date("2026-01-01T10:00:00.000Z"),
      mtags: { batch: "batchCH" },
    });

    // Message must NOT appear in the store during the batch
    const msgs = useStore.getState().messages["srv-1-chan-1"];
    expect(msgs ?? []).toHaveLength(0);
    // Message IS in the buffer
    expect(chathistoryBuffers.get("batchCH")).toHaveLength(1);
    expect(chathistoryBuffers.get("batchCH")?.[0].content).toBe(
      "historical message",
    );
  });

  it("buffer is flushed to the store at BATCH_END", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchFlush: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });

    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "buffered message",
      timestamp: new Date("2026-01-01T10:00:00.000Z"),
      mtags: { batch: "batchFlush" },
    });

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchFlush",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    expect(msgs?.some((m) => m.content === "buffered message")).toBe(true);
  });

  it("buffer is cleared after BATCH_END", () => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchClean: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });
    chathistoryBuffers.set("batchClean", [
      makeMessage({ id: "m1", msgid: "m1" }),
    ]);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchClean",
    });

    expect(chathistoryBuffers.has("batchClean")).toBe(false);
  });

  it("msgid dedup: message already in store is not added again at BATCH_END", () => {
    const existing = makeMessage({
      id: "live-1",
      msgid: "live-msgid-1",
      content: "live",
    });
    useStore.setState({
      messages: { "srv-1-chan-1": [existing] },
      activeBatches: {
        "srv-1": {
          batchDedup: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });
    // Same message arrives via history
    chathistoryBuffers.set("batchDedup", [
      makeMessage({ id: "hist-1", msgid: "live-msgid-1", content: "live" }),
    ]);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchDedup",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    const dupes = msgs?.filter((m) => m.msgid === "live-msgid-1");
    expect(dupes).toHaveLength(1);
  });

  it("isLoadingHistory is cleared at BATCH_END", () => {
    useStore.setState({
      servers: [
        {
          id: "srv-1",
          name: "TestServer",
          host: "irc.example.com",
          port: 6667,
          ssl: false,
          channels: [
            makeChannel({ isLoadingHistory: true } as Partial<Channel>),
          ],
          privateChats: [],
          isConnected: true,
          isConnecting: false,
          capabilities: ["draft/chathistory"],
        },
      ],
      activeBatches: {
        "srv-1": {
          batchLoad: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    } as unknown as AppState);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchLoad",
    });

    const server = useStore.getState().servers.find((s) => s.id === "srv-1");
    const channel = server?.channels.find((c) => c.name === "#test");
    expect(channel?.isLoadingHistory).toBe(false);
  });
});

describe("chathistory batch — reactions and replies", () => {
  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
    historyEditBuffers.clear();
    useStore.setState({
      processedMessageIds: new Set(),
      activeBatches: {
        "srv-1": {
          batchRR: {
            type: "chathistory",
            parameters: ["#test"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    } as unknown as AppState);
  });

  it("reaction TAGMSG during batch is applied to message after BATCH_END", () => {
    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "react to me",
      timestamp: new Date("2026-01-01T10:00:00.000Z"),
      mtags: { batch: "batchRR", msgid: "msg-react-1" },
    });

    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "bob",
      channelName: "#test",
      timestamp: new Date("2026-01-01T10:00:01.000Z"),
      mtags: {
        batch: "batchRR",
        "+draft/react": "👍",
        "+draft/reply": "msg-react-1",
      },
    });

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchRR",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    const target = msgs?.find((m) => m.msgid === "msg-react-1");
    expect(target).toBeDefined();
    expect(target?.reactions).toEqual([{ emoji: "👍", userId: "bob" }]);
  });

  it("unreaction TAGMSG during batch removes reaction after BATCH_END", () => {
    // Buffer a message that already has a reaction pre-applied
    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "unreact from me",
      timestamp: new Date("2026-01-01T10:01:00.000Z"),
      mtags: { batch: "batchRR", msgid: "msg-unreact-1" },
    });

    // Manually set the buffered message to have an existing reaction
    const buf = chathistoryBuffers.get("batchRR");
    if (buf) {
      const m = buf.find((m) => m.msgid === "msg-unreact-1");
      if (m) m.reactions = [{ emoji: "👍", userId: "bob" }];
    }

    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "bob",
      channelName: "#test",
      timestamp: new Date("2026-01-01T10:01:01.000Z"),
      mtags: {
        batch: "batchRR",
        "+draft/unreact": "👍",
        "+draft/reply": "msg-unreact-1",
      },
    });

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchRR",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    const target = msgs?.find((m) => m.msgid === "msg-unreact-1");
    expect(target).toBeDefined();
    expect(target?.reactions).toEqual([]);
  });

  it("reply within the same batch resolves after BATCH_END", () => {
    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "original message",
      timestamp: new Date("2026-01-01T10:00:00.000Z"),
      mtags: { batch: "batchRR", msgid: "msg-orig" },
    });

    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "bob",
      channelName: "#test",
      message: "reply to alice",
      timestamp: new Date("2026-01-01T10:01:00.000Z"),
      mtags: {
        batch: "batchRR",
        msgid: "msg-reply",
        "+draft/reply": "msg-orig",
      },
    });

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchRR",
    });

    const msgs = useStore.getState().messages["srv-1-chan-1"];
    const reply = msgs?.find((m) => m.msgid === "msg-reply");
    expect(reply).toBeDefined();
    expect(reply?.replyMessage?.msgid).toBe("msg-orig");
  });

  it("applies a replayed redaction to a message from the same batch", () => {
    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "oops",
      timestamp: new Date("2026-01-01T10:03:00.000Z"),
      mtags: { batch: "batchRR", msgid: "msg-redacted" },
    });
    ircClient.triggerEvent("REDACT", {
      serverId: "srv-1",
      sender: "alice",
      target: "#test",
      msgid: "msg-redacted",
      reason: "",
      mtags: { batch: "batchRR" },
    });
    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchRR",
    });

    const target = useStore
      .getState()
      .messages["srv-1-chan-1"]?.find((m) => m.msgid === "msg-redacted");
    expect(target?.content).toBe("");
    expect(target?.tags?.["obby-redacted-by"]).toBe("sender");
  });

  it("applies a replayed reaction aimed at one line of a multiline message", () => {
    ircClient.triggerEvent("MULTILINE_MESSAGE", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      target: "#test",
      message: "line one\nline two",
      lines: ["line one", "line two"],
      messageIds: ["line-1", "line-2"],
      timestamp: new Date("2026-01-01T10:04:00.000Z"),
      mtags: { batch: "batchRR", msgid: "multi-1" },
    });
    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "bob",
      channelName: "#test",
      timestamp: new Date("2026-01-01T10:04:01.000Z"),
      mtags: {
        batch: "batchRR",
        "+draft/react": "👍",
        "+draft/reply": "line-2",
      },
    });
    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchRR",
    });

    const multi = useStore
      .getState()
      .messages["srv-1-chan-1"]?.find((m) => m.msgid === "multi-1");
    expect(multi?.reactions).toEqual([{ emoji: "👍", userId: "bob" }]);
  });

  it("does not answer a CTCP request replayed from history", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    ircClient.triggerEvent("CHANMSG", {
      serverId: "srv-1",
      sender: "alice",
      channelName: "#test",
      message: "\u0001VERSION\u0001",
      timestamp: new Date("2026-01-01T10:05:00.000Z"),
      mtags: { batch: "batchRR", msgid: "ctcp-1" },
    });
    expect(sendRaw).not.toHaveBeenCalled();
    sendRaw.mockRestore();
  });
});

describe("chathistory for a private chat", () => {
  const privateChat = () =>
    useStore
      .getState()
      .servers.find((s) => s.id === "srv-1")
      ?.privateChats?.find((pc) => pc.username === "Bob");

  beforeEach(() => {
    setupServer();
    chathistoryBuffers.clear();
    useStore.setState((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        privateChats: [
          {
            id: "pm-1",
            username: "Bob",
            serverId: "srv-1",
            unreadCount: 0,
            isMentioned: false,
          },
        ],
      })),
    }));
  });

  it("marks the private chat as loading and not loading again", () => {
    ircClient.triggerEvent("CHATHISTORY_LOADING", {
      serverId: "srv-1",
      channelName: "bob",
      isLoading: true,
    });
    expect(privateChat()?.isLoadingHistory).toBe(true);

    ircClient.triggerEvent("CHATHISTORY_LOADING", {
      serverId: "srv-1",
      channelName: "bob",
      isLoading: false,
    });
    expect(privateChat()?.isLoadingHistory).toBe(false);
  });

  it.each([
    ["has messages", [makeMessage({ id: "f1", msgid: "f1" })], true],
    ["is empty", [], false],
  ])("sets hasMoreHistory when the batch %s", (_name, buffered, expected) => {
    useStore.setState({
      activeBatches: {
        "srv-1": {
          batchPM: {
            type: "chathistory",
            parameters: ["bob"],
            events: [],
            startTime: new Date(),
          },
        },
      },
    });
    chathistoryBuffers.set("batchPM", buffered);

    ircClient.triggerEvent("BATCH_END", {
      serverId: "srv-1",
      batchId: "batchPM",
    });

    expect(privateChat()?.hasMoreHistory).toBe(expected);
  });
});

describe("a refused chathistory request", () => {
  beforeEach(() => {
    setupServer();
    useStore.setState((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        channels: [makeChannel({ isLoadingHistory: true })],
      })),
    }));
  });

  it("stops loading the channel it names", () => {
    const reason = "Messages could not be retrieved";
    IRC_DISPATCH.FAIL(
      ircClient as unknown as IRCClientContext,
      "srv-1",
      "irc.example.com",
      ["CHATHISTORY", "INVALID_TARGET", "LATEST", "#test", reason],
      undefined,
      reason,
    );

    const channel = useStore.getState().servers[0].channels[0];
    expect(channel.isLoadingHistory).toBe(false);
  });
});
