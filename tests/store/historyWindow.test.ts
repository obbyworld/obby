import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/store";
import type { Message } from "../../src/types";

vi.mock("../../src/lib/notificationSounds", () => ({
  playNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => false),
}));

const SERVER = "srv";
const KEY = `${SERVER}-chan-1`;
const PM_KEY = `${SERVER}-pm-bob`;
const BASE = Date.parse("2026-01-01T12:00:00.000Z");
const WRITE_TIMEOUT_MS = 60_000;

const timeOf = (index: number) => BASE + index * 1000;
const line = (index: number, target = "#chan", nick = "alice") =>
  `@msgid=m${index};time=${new Date(timeOf(index)).toISOString()} :${nick}!u@h PRIVMSG ${target} :line ${index}`;
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);

async function boot(caps = ["message-tags"]) {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const { default: useStore } = await import("../../src/store");
  const { default: ircClient } = await import("../../src/lib/ircClient");
  const db = await import("../../src/lib/history/historyDb");
  const history = await import("../../src/store/handlers/history");
  const { jumpToMessage } = await import("../../src/lib/jumpToMessage");
  const sent: string[] = [];
  const client = ircClient as unknown as {
    sockets: Map<string, unknown>;
    handleMessage(data: string, serverId: string): void;
  };
  client.sockets.set(SERVER, {
    readyState: WebSocket.OPEN,
    send: (raw: string) => sent.push(raw),
    close: () => {},
  });
  const server = {
    id: SERVER,
    name: "TestNet",
    host: "irc.test",
    port: 6667,
    isConnected: true,
    capabilities: caps,
    privateChats: [
      {
        id: "pm-bob",
        username: "bob",
        serverId: SERVER,
        unreadCount: 0,
        isMentioned: false,
      },
    ],
    channels: [
      {
        id: "chan-1",
        name: "#chan",
        isPrivate: false,
        serverId: SERVER,
        unreadCount: 0,
        isMentioned: false,
        messages: [],
        users: [],
      },
    ],
  };
  ircClient.servers.set(SERVER, { ...server, channels: [] } as never);
  ircClient.nicks.set(SERVER, "tester");
  useStore.setState({ servers: [server] } as unknown as AppState);

  const feed = (...lines: string[]) =>
    client.handleMessage(`${lines.join("\r\n")}\r\n`, SERVER);
  const shown = (key = KEY) =>
    (useStore.getState().messages[key] ?? []).map((m) => m.msgid);
  const window = (key = KEY) => useStore.getState().historyWindows[key];
  const channel = () => useStore.getState().servers[0].channels[0];

  // We save rows the way live traffic does, then start over with only the
  // newest page on screen as after a restart.
  const save = async (
    count: number,
    target = "#chan",
    nick = "alice",
    savedAs = target,
  ) => {
    feed(
      ...Array.from({ length: count }, (_, index) => line(index, target, nick)),
    );
    await vi.waitFor(
      async () =>
        expect(
          await db.newestEventRows(SERVER, savedAs, count + 1),
        ).toHaveLength(count),
      { timeout: WRITE_TIMEOUT_MS },
    );
    useStore.setState({ messages: {} });
  };
  const showNewest = async () => {
    history.showSavedHistory(useStore, SERVER, "#chan");
    await vi.waitFor(() => expect(shown()).toHaveLength(100));
  };
  const jumpTo = (index: number, target = "#chan", nick = "alice") =>
    jumpToMessage({
      serverId: SERVER,
      target,
      time: timeOf(index),
      msgid: `m${index}`,
      nick,
      text: `line ${index}`,
    });
  const jumpedTo = () => {
    const jump = useStore.getState().ui.messageJump;
    return Object.values(useStore.getState().messages)
      .flat()
      .find((m) => m.id === jump?.messageId)?.msgid;
  };
  const pageNewer = () => history.loadNewerMessages(useStore, SERVER, "#chan");

  return {
    useStore,
    ircClient,
    db,
    history,
    sent,
    feed,
    shown,
    window,
    channel,
    save,
    showNewest,
    jumpTo,
    jumpedTo,
    pageNewer,
  };
}

describe("history windows", { timeout: 2 * WRITE_TIMEOUT_MS }, () => {
  it("jumps 2000 rows deep into a window around the message and reveals it", async () => {
    const w = await boot();
    await w.save(2000);
    await w.showNewest();

    expect(await w.jumpTo(30)).toMatchObject({ ok: true });

    expect(w.shown()).toEqual(ids(0, 80));
    expect(w.jumpedTo()).toBe("m30");
    expect(w.window()?.until).toBe(timeOf(80));
    expect(w.window()?.present.map((m) => m.msgid)).toEqual(ids(1900, 1999));
  });

  it("pages newer rows from the bottom until it reaches the present", async () => {
    const w = await boot();
    await w.save(400);
    await w.showNewest();
    await w.jumpTo(100);
    expect(w.shown()).toEqual(ids(51, 150));

    await w.pageNewer();
    expect(w.shown()).toEqual(ids(51, 200));
    expect(w.window()?.until).toBe(timeOf(200));

    for (let page = 0; page < 3; page++) await w.pageNewer();
    expect(w.shown()).toEqual(ids(51, 350));

    await w.pageNewer();
    expect(w.window()).toBeUndefined();
    expect(w.shown()).toEqual(ids(300, 399));
  });

  it("drops the oldest messages while paging newer and loads them back above", async () => {
    const w = await boot();
    await w.save(700);
    await w.showNewest();
    await w.jumpTo(100);

    for (let page = 0; page < 6; page++) await w.pageNewer();
    expect(w.shown()).toEqual(ids(151, 450));
    expect(w.channel().hasMoreHistory).toBe(true);

    await w.history.loadOlderMessages(w.useStore, SERVER, "#chan", timeOf(151));
    await vi.waitFor(() => expect(w.shown()).toEqual(ids(51, 450)));
    expect(w.window()?.until).toBe(timeOf(450));
  });

  it("shows the present again when the user jumps to it", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);

    w.history.showPresent(w.useStore, SERVER, "#chan");

    expect(w.window()).toBeUndefined();
    expect(w.shown()).toEqual(ids(200, 299));
  });

  it("asks the server for the newest page when it returns to the present", async () => {
    const w = await boot(["draft/chathistory", "message-tags"]);
    await w.save(300);
    await w.jumpTo(50);
    expect(w.window()).toBeDefined();

    w.history.showPresent(w.useStore, SERVER, "#chan");

    expect(w.window()).toBeUndefined();
    expect(w.sent.at(-1)).toMatch(/^CHATHISTORY LATEST #chan \* /);
  });

  it("keeps a live message out of the window, saves it and counts it unread", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);
    const before = w.shown();
    w.useStore.setState((state) => ({
      ui: { ...state.ui, selectedServerId: null },
    }));

    w.feed(line(1000));

    expect(w.shown()).toEqual(before);
    expect(w.window()?.present.at(-1)?.msgid).toBe("m1000");
    expect(w.channel().unreadCount).toBe(1);
    await vi.waitFor(async () =>
      expect((await w.db.newestEventRows(SERVER, "#chan", 1))[0]?.msgid).toBe(
        "m1000",
      ),
    );

    w.history.showPresent(w.useStore, SERVER, "#chan");
    expect(w.shown().at(-1)).toBe("m1000");
  });

  it("returns to the present before a message we send goes out", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);

    w.ircClient.sendRaw(SERVER, "PRIVMSG #chan :hello");

    expect(w.window()).toBeUndefined();
    expect(w.shown()).toEqual(ids(200, 299));
  });

  it("stays in the window for a reaction we send", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);

    w.ircClient.sendRaw(
      SERVER,
      "@+draft/react=👍;+draft/reply=m50 TAGMSG #chan",
    );

    expect(w.window()).toBeDefined();
  });

  it("applies reactions and deletions to messages waiting in the present", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);

    w.feed(
      "@+draft/react=👍;+draft/reply=m299 :bob!u@h TAGMSG #chan",
      ":bob!u@h REDACT #chan m298",
    );
    w.history.showPresent(w.useStore, SERVER, "#chan");

    const present = w.useStore.getState().messages[KEY];
    expect(present.find((m) => m.msgid === "m299")?.reactions).toEqual([
      { emoji: "👍", userId: "bob" },
    ]);
    const redacted = present.find((m) => m.msgid === "m298");
    expect(redacted?.type).toBe("system");
    expect(redacted?.tags?.["obby-redacted-by"]).toBe("staff");
  });

  it("drops a slow jump once a newer one has landed", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();

    const deepJump = w.jumpTo(30);
    expect(await w.jumpTo(250)).toMatchObject({ ok: true });
    await deepJump;

    expect(w.window()).toBeUndefined();
    expect(w.jumpedTo()).toBe("m250");
  });

  it("keeps the window whole when live lines pass the message cap", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);
    const before = w.shown();
    w.useStore.setState((state) => ({
      messages: {
        ...state.messages,
        [KEY]: [
          ...Array.from({ length: 1500 - before.length }, (_, index) => ({
            ...state.messages[KEY][0],
            id: `filler-${index}`,
            msgid: `filler-${index}`,
          })),
          ...state.messages[KEY],
        ],
      },
    }));
    const top = w.shown()[0];

    w.feed(line(1000));

    expect(w.shown()[0]).toBe(top);
    expect(w.window()?.present.at(-1)?.msgid).toBe("m1000");
  });

  it("loads older saved rows inside a window", async () => {
    const w = await boot();
    await w.save(400);
    await w.showNewest();
    await w.jumpTo(200);
    expect(w.shown()).toEqual(ids(151, 250));

    expect(
      await w.history.loadOlderMessages(
        w.useStore,
        SERVER,
        "#chan",
        timeOf(151),
      ),
    ).toBe(true);

    await vi.waitFor(() => expect(w.shown()).toEqual(ids(51, 250)));
    expect(w.window()?.until).toBe(timeOf(250));
  });

  it("replaces the window on each jump and keeps the first present", async () => {
    const w = await boot();
    await w.save(400);
    await w.showNewest();

    await w.jumpTo(100);
    await w.jumpTo(250);

    expect(w.shown()).toEqual(ids(201, 300));
    expect(w.jumpedTo()).toBe("m250");
    expect(w.window()?.present.map((m) => m.msgid)).toEqual(ids(300, 399));
  });

  it("joins the present when the rows after the message reach the newest", async () => {
    const w = await boot();
    await w.save(400);
    await w.showNewest();
    w.useStore.setState((state) => ({
      messages: { [KEY]: state.messages[KEY].slice(-20) },
    }));

    expect(await w.jumpTo(360)).toMatchObject({ ok: true });

    expect(w.window()).toBeUndefined();
    expect(w.shown()).toEqual(ids(311, 399));
    expect(w.jumpedTo()).toBe("m360");
  });

  it("jumps back to a message that waits in the present", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    await w.jumpTo(50);

    expect(await w.jumpTo(290)).toMatchObject({ ok: true });

    expect(w.window()).toBeUndefined();
    expect(w.jumpedTo()).toBe("m290");
  });

  it("builds a window for a private chat", async () => {
    const w = await boot();
    await w.save(200, "tester", "bob", "bob");

    expect(await w.jumpTo(20, "bob", "bob")).toMatchObject({ ok: true });

    expect(w.shown(PM_KEY)).toEqual(ids(0, 70));
    expect(w.window(PM_KEY)).toBeDefined();
    expect(w.jumpedTo()).toBe("m20");
  });

  it("reports a message that is not loaded as not saved while history is off", async () => {
    const w = await boot();
    await w.save(300);
    await w.showNewest();
    w.useStore.getState().updateGlobalSettings({ keepHistory: false });

    expect(await w.jumpTo(50)).toEqual({ ok: false, reason: "not-saved" });
    expect(await w.jumpTo(250)).toMatchObject({ ok: true });
  });

  it("drops the newest end when older rows pass the cap and keeps it as the present", async () => {
    const w = await boot();
    await w.save(100);
    const newer: Message[] = Array.from({ length: 1500 }, (_, index) => ({
      id: `live-${index}`,
      msgid: `live-${index}`,
      type: "message",
      content: `live ${index}`,
      timestamp: new Date(timeOf(1000 + index)),
      userId: "alice",
      channelId: "chan-1",
      serverId: SERVER,
      reactions: [],
      replyMessage: null,
      mentioned: [],
    }));
    w.useStore.setState({ messages: { [KEY]: newer } });

    await w.history.loadOlderMessages(
      w.useStore,
      SERVER,
      "#chan",
      timeOf(1000),
    );

    await vi.waitFor(() => expect(w.shown()[0]).toBe("m0"));
    expect(w.shown()).toHaveLength(1500);
    expect(w.window()?.until).toBe(timeOf(1000 + 1399));
    expect(w.window()?.present).toBe(newer);
  });
});
