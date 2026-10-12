import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/store";

vi.mock("../../src/lib/notificationSounds", () => ({
  playNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => true),
}));

vi.mock("../../src/store/handlers/otr", () => ({
  handleInboundOtr: (_serverId: string, _nick: string, body: string) =>
    body.startsWith("?OTR"),
  startOtrSession: vi.fn(),
  sendOtrMessage: vi.fn(),
  endOtrSession: vi.fn(),
  trustOtrChangedKey: vi.fn(),
  verifyOtrSession: vi.fn(),
}));

const SERVER = "srv";
const OWN_NICK = "tester";
const MESSAGES_KEY = `${SERVER}-chan-1`;
const BASE = Date.parse("2026-01-01T12:00:00.000Z");
const FAR_FUTURE = BASE + 86_400_000;
const FULL_CAPS = ["draft/chathistory", "echo-message", "message-tags"];

const at = (seconds: number) => new Date(BASE + seconds * 1000).toISOString();

const privmsg = (
  msgid: string,
  seconds: number,
  text: string,
  nick = "alice",
  target = "#chan",
) =>
  `@msgid=${msgid};time=${at(seconds)} :${nick}!u@h PRIVMSG ${target} :${text}`;

const reactionTag = (
  msgid: string,
  seconds: number,
  tag: string,
  emoji: string,
  replyTo: string,
) =>
  `@msgid=${msgid};time=${at(seconds)};${tag}=${emoji};+draft/reply=${replyTo} :bob!u@h TAGMSG #chan`;

const page = (count: number, firstSecond: number, idPrefix: string) =>
  Array.from({ length: count }, (_, index) =>
    privmsg(
      `${idPrefix}${index}`,
      firstSecond + index,
      `${idPrefix} line ${index}`,
    ),
  );

const inBatch = (batchId: string, target: string, lines: string[]) => [
  `:irc.test BATCH +${batchId} chathistory ${target}`,
  ...lines.map((line) => line.replace("@", `@batch=${batchId};`)),
  `:irc.test BATCH -${batchId}`,
];

async function boot(caps: string[]) {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const { default: useStore } = await import("../../src/store");
  const { default: ircClient } = await import("../../src/lib/ircClient");
  const db = await import("../../src/lib/history/historyDb");
  const { loadOlderMessages, showSavedHistory } = await import(
    "../../src/store/handlers/history"
  );
  const sounds = await import("../../src/lib/notificationSounds");

  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN as number,
    send: (line: string) => sent.push(line),
    close: () => {},
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  const client = ircClient as unknown as {
    sockets: Map<string, unknown>;
    handleMessage(data: string, serverId: string): void;
  };
  client.sockets.set(SERVER, socket);

  const user = (username: string) => ({
    id: `${username}-id`,
    username,
    isOnline: true,
  });
  const addServer = (
    id: string,
    host: string,
    port = 6667,
    extra: Record<string, unknown> = {},
  ) => {
    const server = {
      ...extra,
      id,
      name: "TestNet",
      host,
      port,
      ssl: false,
      isConnected: true,
      isConnecting: false,
      capabilities: caps,
      privateChats: [],
      channels: [
        {
          id: "chan-1",
          name: "#chan",
          isPrivate: false,
          serverId: id,
          unreadCount: 0,
          isMentioned: false,
          readMarker: new Date(BASE).toISOString(),
          messages: [],
          users: [user("alice"), user("bob"), user(OWN_NICK)],
        },
      ],
    };
    ircClient.servers.set(id, { ...server, channels: [] } as never);
    ircClient.nicks.set(id, OWN_NICK);
    (
      ircClient as unknown as { currentUsers: Map<string, unknown> }
    ).currentUsers.set(id, user(OWN_NICK));
    useStore.setState((state) => ({
      servers: [...state.servers, server] as unknown as AppState["servers"],
    }));
  };
  useStore.setState({ servers: [] } as unknown as AppState);
  addServer(SERVER, "irc.test");

  const feed = (...lines: string[]) =>
    client.handleMessage(`${lines.join("\r\n")}\r\n`, SERVER);
  const channelMessages = () =>
    useStore.getState().messages[MESSAGES_KEY] ?? [];
  const channel = () =>
    useStore.getState().servers[0].channels.find((c) => c.name === "#chan");
  const stored = (target = "#chan") => db.newestEventRows(SERVER, target, 1000);
  const drain = async () => {
    for (let pass = 0; pass < 8; pass++) await db.usageBytes();
  };
  const chathistoryRequests = () =>
    sent.filter((line) => line.startsWith("CHATHISTORY"));
  const restart = () => useStore.setState({ messages: {} });
  const loadOlderFor = (
    serverId: string,
    oldestTime = FAR_FUTURE,
    target = "#chan",
  ) => loadOlderMessages(useStore, serverId, target, oldestTime);
  const showSaved = (serverId = SERVER, target = "#chan") =>
    showSavedHistory(useStore, serverId, target);
  const addPrivateChat = (username: string) =>
    useStore.setState((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        privateChats: [
          ...(server.privateChats ?? []),
          {
            id: `pm-${username}`,
            username,
            serverId: server.id,
            unreadCount: 0,
            isMentioned: false,
          },
        ],
      })),
    }));
  const privateChat = (username: string) =>
    useStore
      .getState()
      .servers[0].privateChats?.find((pc) => pc.username === username);
  const dropSocket = () => {
    socket.readyState = WebSocket.CLOSED;
  };
  const loadOlder = (oldestTime = FAR_FUTURE) =>
    loadOlderFor(SERVER, oldestTime);

  return {
    useStore,
    ircClient,
    db,
    sounds,
    addServer,
    sent,
    user,
    feed,
    channelMessages,
    channel,
    stored,
    drain,
    chathistoryRequests,
    restart,
    loadOlder,
    loadOlderFor,
    showSaved,
    addPrivateChat,
    privateChat,
    dropSocket,
    socket,
  };
}

type World = Awaited<ReturnType<typeof boot>>;

describe("local history with a chathistory server", () => {
  let w: World;

  beforeEach(async () => {
    w = await boot(FULL_CAPS);
  });

  describe("replay", () => {
    it("stores live channel messages and replays them in order after a restart", async () => {
      w.feed(
        privmsg("m1", 1, "one"),
        privmsg("m2", 2, "two"),
        privmsg("m3", 3, "three"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));

      w.restart();
      expect(w.channelMessages()).toEqual([]);
      await w.loadOlder();

      const replayed = w.channelMessages();
      expect(replayed.map((m) => m.content)).toEqual(["one", "two", "three"]);
      expect(replayed.map((m) => m.msgid)).toEqual(["m1", "m2", "m3"]);
      for (const message of replayed)
        expect(message.tags?.["obby-local"]).toBeDefined();
    });

    it("replays only the page above the oldest message on screen", async () => {
      w.feed(
        privmsg("m1", 1, "one"),
        privmsg("m2", 2, "two"),
        privmsg("m3", 3, "three"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));
      const newest = w.channelMessages()[2];

      w.useStore.setState({ messages: { [MESSAGES_KEY]: [newest] } });
      await w.loadOlder(BASE + 3000);

      expect(w.channelMessages().map((m) => m.msgid)).toEqual([
        "m1",
        "m2",
        "m3",
      ]);
    });

    it("replays a reaction onto its message and an unreact removes it", async () => {
      w.feed(
        privmsg("m1", 1, "react to me"),
        reactionTag("r1", 2, "+draft/react", "👍", "m1"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
      await vi.waitFor(async () =>
        expect(await w.db.refRowsFor(SERVER, ["m1"])).toHaveLength(1),
      );

      w.restart();
      await w.loadOlder();
      expect(w.channelMessages()[0].reactions).toEqual([
        { emoji: "👍", userId: "bob" },
      ]);

      w.feed(reactionTag("r2", 3, "+draft/unreact", "👍", "m1"));
      await vi.waitFor(async () =>
        expect(await w.db.refRowsFor(SERVER, ["m1"])).toHaveLength(2),
      );

      w.restart();
      await w.loadOlder();
      expect(w.channelMessages()).toHaveLength(1);
      expect(w.channelMessages()[0].reactions).toEqual([]);
    });

    it("drops a redacted message from disk so a replay no longer has it", async () => {
      w.feed(
        privmsg("m1", 1, "keep"),
        privmsg("m2", 2, "remove"),
        reactionTag("r1", 3, "+draft/react", "👍", "m2"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));

      w.feed(`@time=${at(4)} :alice!u@h REDACT #chan m2 :oops`);
      await vi.waitFor(async () =>
        expect((await w.stored()).map((row) => row.msgid)).toEqual(["m1"]),
      );
      expect(await w.db.refRowsFor(SERVER, ["m2"])).toEqual([]);

      w.restart();
      await w.loadOlder();
      expect(w.channelMessages().map((m) => m.msgid)).toEqual(["m1"]);
    });

    it("keeps unread counts, mentions, sounds and member lists untouched", async () => {
      w.feed(privmsg("m1", 1, `${OWN_NICK}: ping`));
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
      const oldEvents: [string, number, string][] = [
        ["j1", 2, ":carol!u@h JOIN #chan"],
        ["p1", 3, ":dave!u@h PART #chan :bye"],
        ["q1", 4, ":alice!u@h QUIT :gone"],
        ["n1", 5, ":bob!u@h NICK :bobby"],
      ];
      await w.db.appendRows(
        oldEvents.map(([msgid, seconds, line]) => ({
          server: SERVER,
          target: "#chan",
          time: BASE + seconds * 1000,
          key: msgid,
          msgid,
          raw: `@msgid=${msgid};time=${at(seconds)} ${line}`,
        })),
      );
      expect(await w.stored()).toHaveLength(5);
      expect(w.channel()?.unreadCount).toBeGreaterThan(0);
      expect(w.sounds.playNotificationSound).toHaveBeenCalled();

      w.restart();
      const members = [w.user("alice"), w.user(OWN_NICK)];
      w.useStore.setState((state) => ({
        servers: state.servers.map((server) => ({
          ...server,
          channels: server.channels.map((channel) => ({
            ...channel,
            users: members,
            unreadCount: 0,
            mentionCount: 0,
            isMentioned: false,
            readMarker: at(5),
          })),
        })),
      }));
      vi.mocked(w.sounds.playNotificationSound).mockClear();

      await w.loadOlder();

      expect(
        w
          .channelMessages()
          .filter((m) => m.type === "message")
          .map((m) => m.msgid),
      ).toEqual(["m1"]);
      expect(w.channel()?.users).toEqual(members);
      expect(w.channel()?.unreadCount).toBe(0);
      expect(w.channel()?.mentionCount ?? 0).toBe(0);
      expect(w.channel()?.isMentioned).toBe(false);
      expect(w.sounds.playNotificationSound).not.toHaveBeenCalled();
    });
  });

  describe("server pages", () => {
    const seedDisk = async () => {
      w.feed(
        privmsg("m1", 1, "one"),
        privmsg("m2", 2, "two"),
        privmsg("m3", 3, "three"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));
    };

    it("does not keep a message that the same page redacts", async () => {
      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(
        ...inBatch("h1", "#chan", [
          privmsg("x0", 9, "stays"),
          privmsg("x1", 10, "goes"),
          `@time=${at(11)} :alice!u@h REDACT #chan x1 :oops`,
        ]),
      );

      await vi.waitFor(async () =>
        expect((await w.stored()).map((row) => row.msgid)).toEqual(["x0"]),
      );
      await w.drain();
      expect((await w.stored()).map((row) => row.msgid)).toEqual(["x0"]);
    });

    it("drops saved messages that a page no longer has inside its span", async () => {
      w.feed(
        privmsg("m1", 1, "before the page"),
        privmsg("m2", 2, "two"),
        privmsg("m3", 3, "redacted while away"),
        privmsg("m4", 4, "four"),
        reactionTag("r1", 5, "+draft/react", "👍", "m3"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(4));

      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(
        ...inBatch("h1", "#chan", [
          privmsg("m2", 2, "two"),
          privmsg("m4", 4, "four"),
        ]),
      );

      await vi.waitFor(async () =>
        expect((await w.stored()).map((row) => row.msgid)).toEqual([
          "m1",
          "m2",
          "m4",
        ]),
      );
      expect(await w.db.refRowsFor(SERVER, ["m3"])).toEqual([]);
    });

    it.each([
      ["an empty", []],
      ["a short", [privmsg("p1", 10, "p one"), privmsg("p2", 11, "p two")]],
    ])("offers older saved rows again after %s latest page", async (_name, lines) => {
      await seedDisk();
      w.restart();
      w.feed(privmsg("l1", 20, "live"));
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(4));

      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(...inBatch("h1", "#chan", lines));

      await vi.waitFor(() => expect(w.channel()?.hasMoreHistory).toBe(true));
    });

    it("offers older saved rows again for a private chat", async () => {
      w.addPrivateChat("bob");
      w.feed(
        `@msgid=b1;time=${at(1)} :bob!u@h PRIVMSG ${OWN_NICK} :one`,
        `@msgid=b2;time=${at(2)} :bob!u@h PRIVMSG ${OWN_NICK} :two`,
      );
      await vi.waitFor(async () =>
        expect(await w.stored("bob")).toHaveLength(2),
      );
      w.restart();
      w.feed(`@msgid=b3;time=${at(20)} :bob!u@h PRIVMSG ${OWN_NICK} :live`);
      await vi.waitFor(async () =>
        expect(await w.stored("bob")).toHaveLength(3),
      );

      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST bob * 50");
      w.feed(...inBatch("h1", "bob", []));

      await vi.waitFor(() =>
        expect(w.privateChat("bob")?.hasMoreHistory).toBe(true),
      );
    });

    it("shows no saved history on its own when the server has chathistory", async () => {
      await seedDisk();
      w.restart();

      w.showSaved();
      await w.drain();

      expect(w.channelMessages()).toEqual([]);
    });

    it("saves an older channel page to disk and shows it from there", async () => {
      expect(await w.loadOlderFor(SERVER, BASE + 100_000)).toBe(true);
      expect(w.chathistoryRequests()).toEqual([
        `CHATHISTORY BEFORE #chan timestamp=${at(100)} 50`,
      ]);

      w.feed(...inBatch("old1", "#chan", page(3, 10, "o")));

      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));
      await vi.waitFor(() =>
        expect(w.channelMessages().map((m) => m.msgid)).toEqual([
          "o0",
          "o1",
          "o2",
        ]),
      );
      expect(w.channel()?.isLoadingHistory).toBe(false);
    });
  });

  describe("gap on reconnect", () => {
    const seedDisk = async () => {
      w.feed(
        privmsg("m1", 1, "one"),
        privmsg("m2", 2, "two"),
        privmsg("m3", 3, "three"),
      );
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));
    };

    const latest = (lines: string[]) => {
      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(...inBatch("h1", "#chan", lines));
    };

    it("saves a gap from the newest stored row when a full newer page has nothing stored", async () => {
      await seedDisk();

      latest(page(50, 1000, "n"));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({
            from: BASE + 3000,
            to: BASE + 1000_000,
            lost: false,
          }),
        ]),
      );
    });

    it("keeps the gap open and unmarked when the newer page is short", async () => {
      await seedDisk();

      latest(page(10, 1000, "n"));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({
            from: BASE + 3000,
            to: BASE + 1000_000,
            lost: false,
          }),
        ]),
      );
      expect(w.channelMessages().some((m) => m.type === "system")).toBe(false);
    });

    it("still saves the gap when a live message arrives between the request and the reply", async () => {
      await seedDisk();

      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(privmsg("n0", 1000, "n line 0"));
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(4));
      w.feed(...inBatch("h1", "#chan", page(50, 1000, "n")));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({
            from: BASE + 3000,
            to: BASE + 1000_000,
            lost: false,
          }),
        ]),
      );
    });

    it("saves no gap when the connection drops before the reply", async () => {
      await seedDisk();

      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.ircClient.triggerEvent("connectionStateChange", {
        serverId: SERVER,
        connectionState: "disconnected",
      });
      w.feed(...inBatch("h1", "#chan", page(50, 1000, "n")));

      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(53));
      await w.drain();
      expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([]);
    });

    it("saves no gap when the page overlaps a stored message", async () => {
      await seedDisk();

      latest([privmsg("m3", 3, "three"), ...page(49, 1000, "n")]);

      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(52));
      await w.drain();
      expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([]);
    });
  });

  describe("gap fill", () => {
    const GAP_TO = BASE + 1000_000;

    beforeEach(async () => {
      w.feed(privmsg("m1", 1, "one"), privmsg("m2", 2, "two"));
      await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
      w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
      w.feed(...inBatch("h1", "#chan", page(50, 1000, "n")));
      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toHaveLength(1),
      );
      // The gap sits between messages on screen, so we fill it at once.
      await vi.waitFor(() =>
        expect(w.chathistoryRequests()).toContain(
          `CHATHISTORY BEFORE #chan timestamp=${new Date(GAP_TO).toISOString()} 50`,
        ),
      );
      w.sent.length = 0;
    });

    it("sends no second request for a gap already being filled", async () => {
      expect(await w.loadOlder(GAP_TO)).toBe(false);
      expect(w.chathistoryRequests()).toEqual([]);
    });

    it("closes the gap once the reply reaches stored rows", async () => {
      w.feed(
        ...inBatch("h2", "#chan", [
          privmsg("m2", 2, "two"),
          ...page(9, 500, "g"),
        ]),
      );

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([]),
      );
    });

    it("shrinks the gap when a full reply does not reach stored rows", async () => {
      w.feed(...inBatch("h2", "#chan", page(50, 500, "g")));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({
            from: BASE + 2000,
            to: BASE + 500_000,
            lost: false,
          }),
        ]),
      );
    });

    it("keeps the gap open when a short reply does not reach stored rows", async () => {
      w.feed(...inBatch("h2", "#chan", page(5, 500, "g")));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({
            to: BASE + 500_000,
            lost: false,
          }),
        ]),
      );
    });

    it("marks the gap lost when the server has nothing older", async () => {
      w.feed(...inBatch("h2", "#chan", []));

      await vi.waitFor(async () =>
        expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
          expect.objectContaining({ to: GAP_TO, lost: true }),
        ]),
      );
    });
  });
});

describe("a gap fill the socket dropped", () => {
  const GAP_TO = BASE + 1000_000;
  let w: World;

  beforeEach(async () => {
    w = await boot(FULL_CAPS);
    w.feed(privmsg("m1", 1, "one"), privmsg("m2", 2, "two"));
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
    w.restart();
    w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
    w.feed(...inBatch("h1", "#chan", page(50, 1000, "n")));
    await vi.waitFor(async () =>
      expect(await w.db.gapsFor(SERVER, "#chan")).toHaveLength(1),
    );
    w.sent.length = 0;
  });

  it("does not claim a later unrelated reply", async () => {
    w.dropSocket();
    await w.loadOlder(GAP_TO);
    expect(w.chathistoryRequests()).toEqual([]);
    w.socket.readyState = WebSocket.OPEN;

    w.ircClient.sendRaw(
      SERVER,
      `CHATHISTORY BEFORE #chan timestamp=${at(400)} 50`,
    );
    w.feed(
      ...inBatch("h2", "#chan", [
        privmsg("m2", 2, "two"),
        ...page(9, 500, "g"),
      ]),
    );

    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(61));
    await w.drain();
    expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
      expect.objectContaining({ from: BASE + 2000, to: GAP_TO, lost: false }),
    ]);
  });

  it("closes the gap when the request goes out and the reply reaches stored rows", async () => {
    await w.loadOlder(GAP_TO);
    expect(w.chathistoryRequests()).toHaveLength(1);

    w.feed(
      ...inBatch("h2", "#chan", [
        privmsg("m2", 2, "two"),
        ...page(9, 500, "g"),
      ]),
    );

    await vi.waitFor(async () =>
      expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([]),
    );
  });
});

describe("local history without chathistory", () => {
  let w: World;

  beforeEach(async () => {
    w = await boot(["message-tags"]);
  });

  it("stores lines without a msgid", async () => {
    w.feed(
      `@time=${at(1)} :alice!u@h PRIVMSG #chan :one`,
      ":alice!u@h PRIVMSG #chan :two",
    );

    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
  });

  it("replays the newest stored page once when the chat is shown", async () => {
    w.feed(
      `@time=${at(1)} :alice!u@h PRIVMSG #chan :one`,
      `@time=${at(4)} :alice!u@h PRIVMSG #chan :two`,
    );
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
    w.restart();

    w.showSaved();

    await vi.waitFor(() => expect(w.channelMessages()).toHaveLength(2));

    w.showSaved();
    await w.drain();

    expect(w.channelMessages()).toHaveLength(2);
  });

  it("stores no rows for joins, parts, quits and nick changes", async () => {
    w.feed(
      `@time=${at(1)} :carol!u@h JOIN #chan`,
      `@time=${at(2)} :carol!u@h PART #chan :bye`,
      `@time=${at(3)} :alice!u@h QUIT :gone`,
      `@time=${at(4)} :bob!u@h NICK :bobby`,
      `@time=${at(5)} :alice!u@h PRIVMSG #chan :after`,
    );

    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
    await w.drain();
    expect((await w.stored()).map((row) => row.raw)).toEqual([
      expect.stringContaining("PRIVMSG #chan :after"),
    ]);
  });

  it("shows no saved history when keepHistory is off", async () => {
    w.feed(`@time=${at(1)} :alice!u@h PRIVMSG #chan :one`);
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
    w.restart();
    w.useStore.getState().updateGlobalSettings({ keepHistory: false });

    w.showSaved();
    await w.drain();

    expect(w.channelMessages()).toEqual([]);
  });

  it("does not replay when another user joins", async () => {
    w.feed(`@time=${at(1)} :alice!u@h PRIVMSG #chan :one`);
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
    w.restart();

    w.feed(":carol!u@h JOIN #chan");
    await w.drain();

    expect(w.channelMessages().filter((m) => m.type === "message")).toEqual([]);
  });

  it("loads older private messages from disk for a private chat", async () => {
    w.addPrivateChat("bob");
    w.feed(
      `@time=${at(1)} :bob!u@h PRIVMSG ${OWN_NICK} :one`,
      `@time=${at(2)} :bob!u@h PRIVMSG ${OWN_NICK} :two`,
    );
    await vi.waitFor(async () => expect(await w.stored("bob")).toHaveLength(2));
    w.restart();

    await w.loadOlderFor(SERVER, FAR_FUTURE, "bob");

    expect(
      (w.useStore.getState().messages[`${SERVER}-pm-bob`] ?? []).map(
        (m) => m.content,
      ),
    ).toEqual(["one", "two"]);
  });

  it("records our own PRIVMSG on send because the server never echoes it", async () => {
    w.ircClient.sendRaw(SERVER, "PRIVMSG #chan :hello there");

    await vi.waitFor(async () =>
      expect((await w.stored()).map((row) => row.raw)).toEqual([
        expect.stringContaining(
          `obby-own=1 :${OWN_NICK}!${OWN_NICK}@local PRIVMSG #chan :hello there`,
        ),
      ]),
    );
  });
});

describe("local history and encryption", () => {
  let w: World;

  beforeEach(async () => {
    w = await boot([]);
    w.addPrivateChat("bob");
    w.useStore.setState({
      e2eeSessions: {
        [`${SERVER}:bob`]: {
          status: "established",
          scheme: "obby",
          verified: false,
          peerFingerprint: "ab:cd",
        },
      },
    });
  });

  it("never stores private messages with a peer that has an active session", async () => {
    w.feed(
      `:bob!u@h PRIVMSG ${OWN_NICK} :secret in`,
      `:carol!u@h PRIVMSG ${OWN_NICK} :plain in`,
    );
    w.ircClient.sendRaw(SERVER, "PRIVMSG bob :secret out");
    w.ircClient.sendRaw(SERVER, "PRIVMSG carol :plain out");

    await vi.waitFor(async () =>
      expect((await w.stored("carol")).map((row) => row.raw)).toEqual([
        expect.stringContaining("plain in"),
        expect.stringContaining("plain out"),
      ]),
    );
    await w.drain();
    expect(await w.stored("bob")).toEqual([]);
  });

  it("never stores the echo of our own message to a peer with an active session", async () => {
    w = await boot(FULL_CAPS);
    w.addPrivateChat("bob");
    w.addPrivateChat("carol");
    w.useStore.setState({
      e2eeSessions: {
        [`${SERVER}:bob`]: {
          status: "established",
          scheme: "obby",
          verified: false,
          peerFingerprint: "ab:cd",
        },
      },
    });

    w.feed(
      `@msgid=e1;time=${at(1)} :${OWN_NICK}!u@h PRIVMSG bob :secret out`,
      `@msgid=e2;time=${at(2)} :${OWN_NICK}!u@h PRIVMSG carol :plain out`,
    );

    await vi.waitFor(async () =>
      expect(await w.stored("carol")).toHaveLength(1),
    );
    await w.drain();
    expect(await w.stored("bob")).toEqual([]);
  });

  it("never stores OTR ciphertext or other OTR frames", async () => {
    w.feed(
      `:carol!u@h PRIVMSG ${OWN_NICK} :?OTR:AAMD`,
      `:carol!u@h PRIVMSG ${OWN_NICK} :?OTRv23?`,
      `:carol!u@h PRIVMSG ${OWN_NICK} :?OTR|1|2,3,4,x.`,
      `:carol!u@h PRIVMSG ${OWN_NICK} :?OTR Error: nope`,
      `:carol!u@h PRIVMSG ${OWN_NICK} :visible`,
    );
    w.ircClient.sendRaw(SERVER, "PRIVMSG carol :?OTR:AAMD.");

    await vi.waitFor(async () =>
      expect((await w.stored("carol")).map((row) => row.raw)).toEqual([
        expect.stringContaining(":visible"),
      ]),
    );
    await w.drain();
    expect(await w.stored("carol")).toHaveLength(1);
  });
});

describe("keepHistory off", () => {
  it("stores nothing, neither received nor sent", async () => {
    const w = await boot(["message-tags"]);
    w.useStore.getState().updateGlobalSettings({ keepHistory: false });

    w.feed(
      `@time=${at(1)} :alice!u@h PRIVMSG #chan :one`,
      `@time=${at(2)} :alice!u@h JOIN #chan`,
    );
    w.ircClient.sendRaw(SERVER, "PRIVMSG #chan :two");
    await w.drain();

    expect(w.channelMessages().some((m) => m.content === "one")).toBe(true);
    expect(await w.stored()).toEqual([]);
  });
});

describe("removing a server", () => {
  let w: World;

  const serverIds = () => w.useStore.getState().servers.map((s) => s.id);
  const confirmTarget = () =>
    w.useStore.getState().ui.removeServerConfirmTarget;

  const seedDisk = async () => {
    w.feed(
      privmsg("m1", 1, "one"),
      privmsg("m2", 2, "two"),
      privmsg("m3", 3, "three"),
    );
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(3));
  };

  const askToRemove = async () => {
    w.useStore.getState().requestDeleteServer(SERVER);
    await vi.waitFor(() => expect(confirmTarget()).toBe(SERVER));
  };

  beforeEach(async () => {
    w = await boot(FULL_CAPS);
  });

  it("removes a server without saved history directly", async () => {
    w.useStore.getState().requestDeleteServer(SERVER);

    await vi.waitFor(() => expect(serverIds()).toEqual([]));
    expect(confirmTarget()).toBeNull();
  });

  it("asks first when the server has saved history", async () => {
    await seedDisk();

    await askToRemove();

    expect(serverIds()).toEqual([SERVER]);
  });

  it("keeps the saved rows when we keep the history", async () => {
    await seedDisk();
    await askToRemove();

    w.useStore.getState().confirmRemoveServer(false);

    expect(serverIds()).toEqual([]);
    expect(confirmTarget()).toBeNull();
    await w.drain();
    expect(await w.stored()).toHaveLength(3);
  });

  it("deletes the saved rows and gaps when we delete the history", async () => {
    w.feed(privmsg("m1", 1, "one"), privmsg("m2", 2, "two"));
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
    w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
    w.feed(...inBatch("h1", "#chan", page(50, 1000, "n")));
    await vi.waitFor(async () =>
      expect(await w.db.gapsFor(SERVER, "#chan")).toHaveLength(1),
    );
    await askToRemove();

    w.useStore.getState().confirmRemoveServer(true);

    expect(serverIds()).toEqual([]);
    await vi.waitFor(async () => expect(await w.stored()).toEqual([]));
    expect(await w.db.hasServerHistory(SERVER)).toBe(false);
    expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([]);
  });

  it("leaves the server and its rows alone when we cancel", async () => {
    await seedDisk();
    await askToRemove();

    w.useStore.getState().cancelRemoveServer();

    expect(confirmTarget()).toBeNull();
    expect(serverIds()).toEqual([SERVER]);
    expect(await w.stored()).toHaveLength(3);
  });

  describe("adding the network again", () => {
    const replayedContents = (serverId: string) =>
      (w.useStore.getState().messages[`${serverId}-chan-1`] ?? []).map(
        (m) => m.content,
      );

    const removeKeepingHistory = async () => {
      await seedDisk();
      await askToRemove();
      w.useStore.getState().confirmRemoveServer(false);
      await w.drain();
    };

    const connect = (serverId: string) =>
      w.ircClient.triggerEvent("connectionStateChange", {
        serverId,
        connectionState: "connected",
      });

    it("brings the kept history back under a new server id once it connects", async () => {
      await removeKeepingHistory();

      w.addServer("srv2", "irc.test");
      connect("srv2");

      await vi.waitFor(async () =>
        expect(await w.db.hasServerHistory("srv2")).toBe(true),
      );
      expect(await w.db.hasServerHistory(SERVER)).toBe(false);
      await w.loadOlderFor("srv2");
      expect(replayedContents("srv2")).toEqual(["one", "two", "three"]);
    });

    it("keeps the history of bouncer networks apart by netid", async () => {
      w.useStore.setState((state) => ({
        servers: state.servers.map((s) =>
          s.id === SERVER
            ? { ...s, bouncerServerId: "bnc", bouncerNetid: "n1" }
            : s,
        ),
      }));
      await seedDisk();
      w.useStore.setState((state) => ({
        ui: {
          ...state.ui,
          disconnectNetworkConfirmTarget: {
            bouncerServerId: "bnc",
            netid: "n1",
            childServerId: SERVER,
          },
        },
      }));
      w.useStore.getState().confirmDisconnectNetwork(false);
      await w.drain();

      w.addServer("other", "irc.test", 6667, {
        bouncerServerId: "bnc2",
        bouncerNetid: "n2",
      });
      connect("other");
      await w.drain();
      expect(await w.db.hasServerHistory("other")).toBe(false);

      w.addServer("same", "irc.test", 6667, {
        bouncerServerId: "bnc2",
        bouncerNetid: "n1",
      });
      connect("same");
      await vi.waitFor(async () =>
        expect(await w.db.hasServerHistory("same")).toBe(true),
      );
    });

    it("deletes every bouncer network's history when we disconnect the bouncer and delete it", async () => {
      w.useStore.setState((state) => ({
        servers: state.servers.map((s) =>
          s.id === SERVER
            ? { ...s, bouncerServerId: "bnc", bouncerNetid: "n1" }
            : s,
        ),
      }));
      w.addServer("bnc", "irc.test", 6667, { isBouncerControl: true });
      await seedDisk();
      w.useStore.setState((state) => ({
        ui: { ...state.ui, disconnectConfirmTarget: "bnc" },
      }));

      w.useStore.getState().confirmDisconnectBouncer(true);

      await vi.waitFor(async () =>
        expect(await w.db.hasServerHistory(SERVER)).toBe(false),
      );
      expect(serverIds()).toEqual([]);
    });

    it("shares history between hosts that differ only in case", async () => {
      await removeKeepingHistory();

      w.addServer("srv2", "IRC.Test");
      connect("srv2");

      await vi.waitFor(async () =>
        expect(await w.db.hasServerHistory("srv2")).toBe(true),
      );
      await w.loadOlderFor("srv2");
      expect(replayedContents("srv2")).toEqual(["one", "two", "three"]);
    });

    it("keeps a different port apart", async () => {
      await removeKeepingHistory();

      w.addServer("srv2", "irc.test", 6697);
      connect("srv2");
      await w.drain();

      expect(await w.db.hasServerHistory("srv2")).toBe(false);
      await w.loadOlderFor("srv2");
      expect(replayedContents("srv2")).toEqual([]);
    });

    it("keeps two live servers at one address apart", async () => {
      await seedDisk();

      w.addServer("srv2", "irc.test");
      connect("srv2");
      connect(SERVER);
      await w.drain();

      expect(await w.db.hasServerHistory("srv2")).toBe(false);
      expect(await w.stored()).toHaveLength(3);
      await w.loadOlderFor("srv2");
      expect(replayedContents("srv2")).toEqual([]);
    });

    it("leaves nothing to adopt after we delete the history", async () => {
      await seedDisk();
      await askToRemove();
      w.useStore.getState().confirmRemoveServer(true);

      w.addServer("srv2", "irc.test");
      connect("srv2");
      await w.drain();

      expect(await w.db.hasServerHistory("srv2")).toBe(false);
      expect(await w.db.hasServerHistory(SERVER)).toBe(false);
    });
  });
});

describe("a server that gains chathistory later", () => {
  let w: World;

  const gainChathistory = () => {
    const server = w.ircClient.servers.get(SERVER) as unknown as {
      capabilities: string[];
    };
    server.capabilities = [...server.capabilities, "draft/chathistory"];
  };

  const requestLatest = (lines: string[]) => {
    w.ircClient.sendRaw(SERVER, "CHATHISTORY LATEST #chan * 50");
    w.feed(...inBatch("h1", "#chan", lines));
  };

  beforeEach(async () => {
    w = await boot(["message-tags"]);
    w.feed(
      `@time=${at(1)} :alice!u@h PRIVMSG #chan :one`,
      `@time=${at(2)} :alice!u@h PRIVMSG #chan :two`,
    );
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(2));
    gainChathistory();
  });

  it("saves a gap from the newest old row when a full page follows", async () => {
    const before = await w.stored();

    requestLatest(page(50, 1000, "n"));

    await vi.waitFor(async () =>
      expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
        expect.objectContaining({
          from: BASE + 2000,
          to: BASE + 1000_000,
          lost: false,
        }),
      ]),
    );
    await w.drain();
    const after = await w.stored();
    expect(after).toHaveLength(52);
    expect(after.slice(0, 2)).toEqual(before);
    expect(new Set(after.map((row) => row.key)).size).toBe(52);
  });

  it("keeps the gap open when the page is short", async () => {
    requestLatest(page(10, 1000, "n"));

    await vi.waitFor(async () =>
      expect(await w.db.gapsFor(SERVER, "#chan")).toEqual([
        expect.objectContaining({
          from: BASE + 2000,
          to: BASE + 1000_000,
          lost: false,
        }),
      ]),
    );
    await w.drain();
    expect(await w.stored()).toHaveLength(12);
  });
});

describe("what we record", () => {
  let w: World;

  beforeEach(async () => {
    w = await boot(["message-tags"]);
  });

  it("skips a channel we are not in and stores the first message of a new PM", async () => {
    w.feed(
      `@time=${at(1)} :alice!u@h PRIVMSG #elsewhere :not ours`,
      `@time=${at(2)} :dave!u@h PRIVMSG ${OWN_NICK} :hello`,
    );

    await vi.waitFor(async () =>
      expect((await w.stored("dave")).map((row) => row.raw)).toEqual([
        expect.stringContaining(":hello"),
      ]),
    );
    await w.drain();
    expect(await w.stored("#elsewhere")).toEqual([]);
  });

  it("skips NickServ and credential PMs even when their chats are open", async () => {
    w.addPrivateChat("NickServ");
    w.addPrivateChat("bob");
    w.feed(
      `@time=${at(1)} :NickServ!s@services PRIVMSG ${OWN_NICK} :You are now identified`,
    );
    w.ircClient.sendRaw(SERVER, "PRIVMSG NickServ :IDENTIFY hunter2");
    w.ircClient.sendRaw(SERVER, "PRIVMSG bob :IDENTIFY hunter2");
    w.ircClient.sendRaw(SERVER, "PRIVMSG bob :plain");

    await vi.waitFor(async () =>
      expect((await w.stored("bob")).map((row) => row.raw)).toEqual([
        expect.stringContaining(":plain"),
      ]),
    );
    await w.drain();
    expect(await w.stored("nickserv")).toEqual([]);
  });

  it("records our own tagged PRIVMSG when the server has no echo-message", async () => {
    w.ircClient.sendRaw(SERVER, "@+draft/reply=m1 PRIVMSG #chan :agreed");

    await vi.waitFor(async () =>
      expect((await w.stored()).map((row) => row.raw)).toEqual([
        expect.stringMatching(
          new RegExp(
            `^@\\+draft/reply=m1;time=[^;]+;obby-own=1 :${OWN_NICK}!${OWN_NICK}@local PRIVMSG #chan :agreed$`,
          ),
        ),
      ]),
    );
  });

  it("never stores a typing notification", async () => {
    w.feed(
      `@time=${at(1)};+typing=active :alice!u@h TAGMSG #chan`,
      ...inBatch("h1", "#chan", [
        `@time=${at(2)};+typing=active :alice!u@h TAGMSG #chan`,
      ]),
      `@time=${at(3)} :alice!u@h PRIVMSG #chan :after`,
    );

    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(1));
    await w.drain();
    expect(await w.stored()).toHaveLength(1);
  });

  it("shows our own replayed PM under the current nick and opens no chat for the old nick", async () => {
    w.addPrivateChat("bob");
    w.ircClient.sendRaw(SERVER, "PRIVMSG bob :from the old nick");
    await vi.waitFor(async () => expect(await w.stored("bob")).toHaveLength(1));

    w.restart();
    w.ircClient.nicks.set(SERVER, "renamed");
    (
      w.ircClient as unknown as { currentUsers: Map<string, unknown> }
    ).currentUsers.set(SERVER, w.user("renamed"));
    w.showSaved(SERVER, "bob");

    await vi.waitFor(() =>
      expect(w.useStore.getState().messages[`${SERVER}-pm-bob`]).toHaveLength(
        1,
      ),
    );
    expect(w.useStore.getState().messages[`${SERVER}-pm-bob`][0].userId).toBe(
      "renamed",
    );
    expect(
      w.useStore.getState().servers[0].privateChats?.map((pc) => pc.username),
    ).toEqual(["bob"]);
  });
});

describe("loading older saved messages", () => {
  let w: World;

  const pmKey = `${SERVER}-pm-bob`;
  const pmMessages = () => w.useStore.getState().messages[pmKey] ?? [];

  beforeEach(async () => {
    w = await boot(["message-tags"]);
  });

  it("resolves false and clears loading when nothing older exists", async () => {
    expect(await w.loadOlder()).toBe(false);

    expect(w.channel()?.isLoadingHistory).toBe(false);
    expect(w.channel()?.hasMoreHistory).toBe(false);
  });

  it("offers more for a private chat after a disk replay that left older rows", async () => {
    w.addPrivateChat("bob");
    w.feed(
      ...Array.from(
        { length: 101 },
        (_, index) =>
          `@msgid=b${index};time=${at(index + 1)} :bob!u@h PRIVMSG ${OWN_NICK} :line ${index}`,
      ),
    );
    await vi.waitFor(async () =>
      expect(await w.stored("bob")).toHaveLength(101),
    );
    w.restart();

    w.showSaved(SERVER, "bob");

    await vi.waitFor(() => expect(pmMessages()).toHaveLength(100));
    await vi.waitFor(() =>
      expect(w.privateChat("bob")?.hasMoreHistory).toBe(true),
    );
  });

  it("shows saved private messages on a chathistory server, once each", async () => {
    w = await boot(FULL_CAPS);
    w.addPrivateChat("bob");
    w.feed(
      privmsg("p1", 1, "first", "bob", OWN_NICK),
      privmsg("p2", 2, "second", "bob", OWN_NICK),
    );
    await vi.waitFor(async () => expect(await w.stored("bob")).toHaveLength(2));
    w.restart();

    w.showSaved(SERVER, "bob");
    await vi.waitFor(() => expect(pmMessages()).toHaveLength(2));
    w.feed(
      ...inBatch("latest", "bob", [
        privmsg("p2", 2, "second", "bob", OWN_NICK),
        privmsg("p3", 3, "third", "bob", OWN_NICK),
      ]),
    );

    await vi.waitFor(() =>
      expect(pmMessages().map((m) => m.content)).toEqual([
        "first",
        "second",
        "third",
      ]),
    );
  });

  it("lists senders from loaded messages while history is off", async () => {
    const { listSavedSenders } = await import(
      "../../src/store/handlers/history"
    );
    w.useStore.getState().updateGlobalSettings({ keepHistory: false });
    w.feed(
      `@time=${at(1)} :Bob!u@h PRIVMSG #chan :hi`,
      `@time=${at(2)} :alice!u@h PRIVMSG #chan :yo`,
      `@time=${at(3)} :bob!u@h PRIVMSG #chan :again`,
    );
    await vi.waitFor(() => expect(w.channelMessages()).toHaveLength(3));

    expect(await listSavedSenders()).toEqual(["alice", "bob"]);
  });

  it("keeps rows that share a millisecond across a page boundary", async () => {
    const sameMs = [0, 1, 2].map(
      (index) =>
        `@msgid=s${index};time=${at(5)} :alice!u@h PRIVMSG #chan :same ${index}`,
    );
    w.feed(...sameMs, ...page(99, 10, "n"));
    await vi.waitFor(async () => expect(await w.stored()).toHaveLength(102));
    w.restart();

    w.showSaved();
    await vi.waitFor(() => expect(w.channelMessages()).toHaveLength(100));
    expect(w.channelMessages()[0].msgid).toBe("s2");
    await vi.waitFor(() => expect(w.channel()?.hasMoreHistory).toBe(true));

    expect(
      await w.loadOlder(new Date(w.channelMessages()[0].timestamp).getTime()),
    ).toBe(true);

    await vi.waitFor(() => expect(w.channelMessages()).toHaveLength(102));
    expect(
      w
        .channelMessages()
        .slice(0, 3)
        .map((m) => m.msgid)
        .sort(),
    ).toEqual(["s0", "s1", "s2"]);
    await vi.waitFor(() => expect(w.channel()?.hasMoreHistory).toBe(false));
  });
});
