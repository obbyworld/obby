import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/store";
import type { Message } from "../../src/types";

const SERVER = "srv";
const EVERYWHERE = { kind: "everywhere" } as const;

async function boot() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const { default: useStore } = await import("../../src/store");
  const { default: ircClient } = await import("../../src/lib/ircClient");
  const db = await import("../../src/lib/history/historyDb");
  const { searchSavedMessages } = await import(
    "../../src/store/handlers/history"
  );
  ircClient.nicks.set(SERVER, "tester");
  useStore.setState({
    servers: [
      {
        id: SERVER,
        name: "TestNet",
        host: "irc.test",
        port: 6667,
        channels: [{ id: "chan-1", name: "#Chan" }],
        privateChats: [{ id: "pm-1", username: "Alice" }],
      },
    ],
  } as unknown as AppState);
  return { useStore, db, search: searchSavedMessages };
}

const message = (
  id: string,
  seconds: number,
  userId: string,
  content: string,
  extra: Partial<Message> = {},
): Message =>
  ({
    id,
    msgid: id,
    type: "message",
    content,
    timestamp: new Date(seconds * 1000),
    userId,
    channelId: "chan-1",
    serverId: SERVER,
    reactions: [],
    replyMessage: null,
    mentioned: [],
    ...extra,
  }) as Message;

describe("searchSavedMessages", () => {
  let w: Awaited<ReturnType<typeof boot>>;

  beforeEach(async () => {
    w = await boot();
  });

  it("searches the loaded messages when history is off", async () => {
    w.useStore.getState().updateGlobalSettings({ keepHistory: false });
    const own = message("o1", 1, "tester", "my question");
    w.useStore.setState({
      messages: {
        [`${SERVER}-chan-1`]: [
          own,
          message("m1", 2, "bob", "\x02see\x02 https://x.io"),
          message("m2", 3, "bob", "answer", { replyMessage: own }),
          message("m3", 4, "bob", "Tester: ping"),
          message("j1", 5, "bob", "see joined", { type: "join" }),
        ],
        [`${SERVER}-pm-1`]: [message("p1", 6, "Alice", "see you")],
      },
    });
    const ids = async (query: object, opts = {}) =>
      (
        await w.search(
          w.useStore,
          { text: "", scope: EVERYWHERE, ...query },
          opts,
        )
      ).hits.map((hit) => hit.msgid);

    expect(await ids({ text: "se" })).toEqual(["p1", "m1"]);
    expect(
      await ids({
        text: "see",
        scope: { kind: "chat", serverId: SERVER, target: "alice" },
      }),
    ).toEqual(["p1"]);
    expect(await ids({ hasLink: true })).toEqual(["m1"]);
    expect(await ids({ from: "BOB", before: 4000 })).toEqual(["m2", "m1"]);
    expect(await ids({ aboutMe: true })).toEqual(["m3", "m2"]);
    const page = await w.search(
      w.useStore,
      { text: "", scope: EVERYWHERE },
      { limit: 2 },
    );
    expect(page.nextBeforeTime).toBe(4000);
    expect(page.hits[0]).toEqual({
      serverId: SERVER,
      target: "alice",
      time: 6000,
      nick: "Alice",
      text: "see you",
      msgid: "p1",
      isAboutMe: false,
    });
  });

  it("searches saved history with our nick from the client", async () => {
    await w.db.appendRows([
      {
        server: SERVER,
        target: "#chan",
        time: 1000,
        key: "m1",
        msgid: "m1",
        raw: "@msgid=m1 :bob!u@h PRIVMSG #Chan :hey tester",
      },
    ]);
    const page = await w.search(w.useStore, {
      text: "",
      scope: { kind: "network", serverId: SERVER },
      aboutMe: true,
    });
    expect(page.hits).toEqual([
      expect.objectContaining({ msgid: "m1", nick: "bob", isAboutMe: true }),
    ]);
  });
});
