import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewHistoryRow } from "../../../src/lib/history/historyDb";
import type { SearchQuery } from "../../../src/lib/search/searchTypes";

type HistoryDb = typeof import("../../../src/lib/history/historyDb");
type HistorySearch = typeof import("../../../src/lib/history/historySearch");

let db: HistoryDb;
let search: HistorySearch;

const OWN = { s1: "tester", s2: "tester" };
const EVERYWHERE = { kind: "everywhere" } as const;

interface Line {
  id: string;
  time: number;
  text: string;
  nick?: string;
  target?: string;
  server?: string;
  own?: boolean;
  reply?: string;
}

function message({
  id,
  time,
  text,
  nick = "alice",
  target = "#a",
  server = "s1",
  own = false,
  reply,
}: Line): NewHistoryRow {
  const tags = [
    `msgid=${id}`,
    ...(reply ? [`+draft/reply=${reply}`] : []),
    ...(own ? ["obby-own=1"] : []),
  ].join(";");
  return {
    server,
    target: target.toLowerCase(),
    time,
    key: id,
    msgid: id,
    raw: `@${tags} :${nick}!u@h PRIVMSG ${target} :${text}`,
  };
}

const reaction = (id: string, time: number, ref: string): NewHistoryRow => ({
  server: "s1",
  target: "#a",
  time,
  key: id,
  msgid: id,
  ref,
  raw: `@msgid=${id};+draft/react=👍;+draft/reply=${ref} :bob!u@h TAGMSG #a`,
});

const find = (
  query: Partial<SearchQuery>,
  opts: { limit?: number; beforeTime?: number; skipAtBeforeTime?: number } = {},
) =>
  search.searchMessages(
    { text: "", scope: EVERYWHERE, ...query },
    { ownNicks: OWN, ...opts },
  );

const ids = async (query: Partial<SearchQuery>) =>
  (await find(query)).hits.map((hit) => hit.msgid);

function termCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("obby-history");
    open.onsuccess = () => {
      const request = open.result
        .transaction("terms")
        .objectStore("terms")
        .count();
      request.onsuccess = () => {
        open.result.close();
        resolve(request.result);
      };
    };
    open.onerror = () => reject(open.error);
  });
}

function isBackfilling(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("obby-history");
    open.onsuccess = () => {
      const request = open.result
        .transaction("meta")
        .objectStore("meta")
        .getKey("searchBackfill");
      request.onsuccess = () => {
        open.result.close();
        resolve(request.result !== undefined);
      };
    };
    open.onerror = () => reject(open.error);
  });
}

async function load() {
  vi.resetModules();
  db = await import("../../../src/lib/history/historyDb");
  search = await import("../../../src/lib/history/historySearch");
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await load();
});

describe("text", () => {
  beforeEach(async () => {
    await db.appendRows([
      message({ id: "m1", time: 1, text: "deploy on friday" }),
      message({ id: "m2", time: 2, text: "deploy on monday" }),
      message({ id: "m3", time: 3, text: "Friday DEPLOY again" }),
      message({ id: "m4", time: 4, text: "nothing here" }),
    ]);
  });

  it("needs every word, newest first, last word as a prefix", async () => {
    expect(await ids({ text: "deploy" })).toEqual(["m3", "m2", "m1"]);
    expect(await ids({ text: "deploy fri" })).toEqual(["m3", "m1"]);
    expect(await ids({ text: "friday dep" })).toEqual(["m3", "m1"]);
    expect(await ids({ text: "deploy sunday" })).toEqual([]);
  });

  it("matches a one letter last word, which the index never holds", async () => {
    await db.appendRows([
      message({ id: "n7", time: 5, text: "deploy 7 done" }),
      message({ id: "n8", time: 6, text: "deploy 8 done" }),
    ]);
    expect(await ids({ text: "deploy 7" })).toEqual(["n7"]);
    expect(await ids({ text: "8" })).toEqual(["n8"]);
  });

  it("finds a long id as the last word and as an earlier word", async () => {
    const sha = "3f9a1c0be27d4e5f8a6b9c0d1e2f3a4b5c6d7e8f";
    await db.appendRows([
      message({ id: "h1", time: 5, text: `reverted ${sha} today` }),
      message({ id: "h2", time: 6, text: `${sha.slice(0, 33)}x other` }),
    ]);
    expect(await ids({ text: sha })).toEqual(["h1"]);
    expect(await ids({ text: `${sha} tod` })).toEqual(["h1"]);
    expect(await ids({ text: sha.slice(0, 36) })).toEqual(["h1"]);
  });

  it("returns the hit with its plain text and display nick", async () => {
    const [hit] = (await find({ text: "nothing" })).hits;
    expect(hit).toEqual({
      serverId: "s1",
      target: "#a",
      time: 4,
      nick: "alice",
      text: "nothing here",
      msgid: "m4",
      isAboutMe: false,
    });
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await db.appendRows([
      message({ id: "a1", time: 1, text: "hello", nick: "Alice" }),
      message({ id: "b1", time: 2, text: "hello https://x.io", nick: "bob" }),
      message({ id: "c1", time: 3, text: "hello", nick: "dan", target: "#B" }),
      message({ id: "d1", time: 4, text: "hello", nick: "dan", server: "s2" }),
      message({ id: "e1", time: 5, text: "hello", nick: "dan", target: "dan" }),
    ]);
  });

  it("limits to a chat, a network or everywhere", async () => {
    expect(
      await ids({
        text: "hello",
        scope: { kind: "chat", serverId: "s1", target: "#A" },
      }),
    ).toEqual(["b1", "a1"]);
    expect(
      await ids({ text: "hello", scope: { kind: "network", serverId: "s1" } }),
    ).toEqual(["e1", "c1", "b1", "a1"]);
    expect(await ids({ text: "hello" })).toEqual([
      "e1",
      "d1",
      "c1",
      "b1",
      "a1",
    ]);
  });

  it("filters by sender case insensitively, with or without text", async () => {
    expect(await ids({ from: "ALICE" })).toEqual(["a1"]);
    expect(await ids({ text: "hel", from: "alice" })).toEqual(["a1"]);
    expect(await ids({ from: "alic" })).toEqual([]);
  });

  it("filters by link", async () => {
    expect(await ids({ hasLink: true })).toEqual(["b1"]);
    expect(await ids({ text: "hello", hasLink: true })).toEqual(["b1"]);
  });

  it("bounds by time on both ends", async () => {
    expect(await ids({ text: "hello", after: 1, before: 5 })).toEqual([
      "d1",
      "c1",
      "b1",
    ]);
    expect(await ids({ after: 3 })).toEqual(["e1", "d1"]);
  });
});

describe("mentions of a person", () => {
  it("finds the whole nick in other people's messages, not their own lines", async () => {
    await db.appendRows([
      message({ id: "v1", time: 1, text: "Valware: are you there" }),
      message({ id: "v2", time: 2, text: "ask @valware about it" }),
      message({ id: "v3", time: 3, text: "valwares plural is not him" }),
      message({ id: "v4", time: 4, text: "my own line", nick: "Valware" }),
      message({ id: "v5", time: 5, text: "the [bot] knows", nick: "bob" }),
      message({ id: "v6", time: 6, text: "valware deploy now" }),
    ]);

    expect(await ids({ mentions: "Valware" })).toEqual(["v6", "v2", "v1"]);
    expect(await ids({ mentions: "valware", text: "dep" })).toEqual(["v6"]);
    expect(await ids({ mentions: "[bot]" })).toEqual(["v5"]);
  });
});

describe("aboutMe", () => {
  it("finds mentions of our nick on that server and replies to our messages", async () => {
    await db.appendRows([
      message({ id: "r1", time: 1, text: "fixed it", reply: "o1" }),
      message({
        id: "o1",
        time: 2,
        text: "it broke",
        nick: "tester",
        own: true,
      }),
      message({ id: "m1", time: 3, text: "tester: look" }),
      message({ id: "m2", time: 4, text: "@Tester look" }),
      message({ id: "m3", time: 5, text: "testers look" }),
      message({ id: "m4", time: 6, text: "tester, hi", server: "s3" }),
      message({ id: "x1", time: 7, text: "reply to alice", reply: "m1" }),
      message({
        id: "o2",
        time: 8,
        text: "tester me",
        nick: "tester",
        own: true,
      }),
      message({ id: "r2", time: 9, text: "ok", reply: "o2" }),
    ]);

    expect(await ids({ aboutMe: true })).toEqual(["r2", "m2", "m1", "r1"]);
    expect(await ids({ aboutMe: true, text: "look" })).toEqual(["m2", "m1"]);
    expect(
      await ids({ aboutMe: true, scope: { kind: "network", serverId: "s1" } }),
    ).toEqual(["r2", "m2", "m1", "r1"]);
    const hits = (await find({ text: "look" })).hits;
    expect(hits.map((hit) => [hit.msgid, hit.isAboutMe])).toEqual([
      ["m3", false],
      ["m2", true],
      ["m1", true],
    ]);
    expect(
      (await find({ aboutMe: true })).hits.map((hit) => [
        hit.msgid,
        hit.aboutMe,
      ]),
    ).toEqual([
      ["r2", "reply"],
      ["m2", "mention"],
      ["m1", "mention"],
      ["r1", "reply"],
    ]);
  });

  it("finds replies whose own message arrives in a later write", async () => {
    await db.appendRows([
      message({ id: "r1", time: 5, text: "answer", reply: "o1" }),
    ]);
    expect(await ids({ aboutMe: true })).toEqual([]);
    await db.appendRows([
      message({
        id: "o1",
        time: 1,
        text: "question",
        nick: "tester",
        own: true,
      }),
    ]);
    expect(await ids({ aboutMe: true })).toEqual(["r1"]);
  });
});

describe("paging and reactions", () => {
  it("pages newest first with nextBeforeTime", async () => {
    await db.appendRows(
      Array.from({ length: 5 }, (_, i) =>
        message({ id: `m${i}`, time: i + 1, text: "page me" }),
      ),
    );
    const first = await find({ text: "page" }, { limit: 2 });
    expect(first.hits.map((hit) => hit.msgid)).toEqual(["m4", "m3"]);
    expect(first.nextBeforeTime).toBe(4);
    const second = await find(
      { text: "page" },
      {
        limit: 2,
        beforeTime: first.nextBeforeTime,
        skipAtBeforeTime: first.nextSkip,
      },
    );
    expect(second.hits.map((hit) => hit.msgid)).toEqual(["m2", "m1"]);
    const last = await find(
      { text: "page" },
      {
        limit: 2,
        beforeTime: second.nextBeforeTime,
        skipAtBeforeTime: second.nextSkip,
      },
    );
    expect(last).toEqual({
      hits: [expect.objectContaining({ msgid: "m0" })],
    });
  });

  it("keeps messages that share a millisecond across a page boundary", async () => {
    await db.appendRows(
      Array.from({ length: 5 }, (_, i) =>
        message({ id: `s${i}`, time: 7, text: "burst line" }),
      ),
    );
    const seen: string[] = [];
    let cursor: { beforeTime?: number; skipAtBeforeTime?: number } = {};
    for (let page = 0; page < 5; page++) {
      const result = await find({ text: "burst" }, { limit: 2, ...cursor });
      seen.push(...result.hits.map((hit) => hit.msgid as string));
      if (result.nextBeforeTime === undefined) break;
      cursor = {
        beforeTime: result.nextBeforeTime,
        skipAtBeforeTime: result.nextSkip,
      };
    }
    expect(seen.sort()).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("never returns reaction rows", async () => {
    await db.appendRows([
      message({ id: "m1", time: 1, text: "bob likes" }),
      reaction("r1", 2, "m1"),
    ]);
    expect(await ids({})).toEqual(["m1"]);
    expect(await ids({ from: "bob" })).toEqual([]);
  });
});

describe("keeping the index in sync", () => {
  const seed = () =>
    db.appendRows([
      message({ id: "m1", time: 1, text: "alpha beta" }),
      message({ id: "m2", time: 2, text: "alpha gamma", target: "#b" }),
      message({ id: "m3", time: 3, text: "alpha", server: "s2" }),
    ]);

  it("drops terms of a redacted message", async () => {
    await seed();
    expect(await termCount()).toBe(5);
    await db.deleteMessage("s1", "#a", "m1");
    expect(await ids({ text: "alpha" })).toEqual(["m3", "m2"]);
    expect(await termCount()).toBe(3);
  });

  it("drops terms of pruned rows and counts them in usage", async () => {
    await seed();
    const usage = await db.usageBytes();
    const [one] = await db.newestEventRows("s1", "#a", 1);
    expect(one.bytes).toBe(one.raw.length + "alpha beta".length + 64 + 105);
    await db.pruneToLimit(usage - 1);
    expect(await ids({ text: "alpha" })).toEqual(["m3", "m2"]);
    expect(await termCount()).toBe(3);
  });

  it("drops terms of a deleted server and on clear", async () => {
    await seed();
    await db.deleteServerHistory("s1");
    expect(await ids({ text: "alpha" })).toEqual(["m3"]);
    expect(await termCount()).toBe(1);
    await db.clearHistory();
    expect(await termCount()).toBe(0);
    expect(await db.usageBytes()).toBe(0);
  });

  it("moves results with adopted history and drops duplicate terms", async () => {
    await seed();
    await db.appendRows([
      message({ id: "m1", time: 1, text: "alpha beta", server: "s9" }),
    ]);
    await db.parkServerHistory("s1", "irc.test:6667");
    expect(await db.adoptParkedHistory("irc.test:6667", "s9")).toBe(true);
    expect(
      await ids({ text: "alpha", scope: { kind: "network", serverId: "s9" } }),
    ).toEqual(["m2", "m1"]);
    expect(
      await ids({ text: "alpha", scope: { kind: "network", serverId: "s1" } }),
    ).toEqual([]);
    expect(await termCount()).toBe(5);
  });
});

describe("upgrading from version 1", () => {
  function seedV1(rows: NewHistoryRow[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("obby-history", 1);
      open.onupgradeneeded = () => {
        const v1 = open.result;
        const store = v1.createObjectStore("rows", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("conv", ["server", "target", "time"]);
        store.createIndex("dedupe", ["server", "target", "key"], {
          unique: true,
        });
        store.createIndex("time", "time");
        store.createIndex("server", "server");
        store.createIndex("ref", ["server", "ref"]);
        store.createIndex("msgid", ["server", "target", "msgid"]);
        v1.createObjectStore("gaps", {
          keyPath: "id",
          autoIncrement: true,
        }).createIndex("conv", ["server", "target"]);
        v1.createObjectStore("meta", { keyPath: "name" });
      };
      open.onsuccess = () => {
        const tx = open.result.transaction(["rows", "meta"], "readwrite");
        for (const row of rows)
          tx.objectStore("rows").add({ ...row, bytes: row.raw.length + 64 });
        tx.objectStore("meta").put({
          name: "bytes",
          value: rows.reduce((sum, row) => sum + row.raw.length + 64, 0),
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
      open.onerror = () => reject(open.error);
    });
  }

  it("indexes old rows in the background and new rows at once", {
    timeout: 30_000,
  }, async () => {
    const old = Array.from({ length: 1003 }, (_, i) =>
      message({ id: `o${i}`, time: i + 1, text: `old row ${i}` }),
    );
    await seedV1([
      ...old,
      message({
        id: "q1",
        time: 5000,
        text: "question",
        own: true,
        nick: "tester",
      }),
      message({ id: "r1", time: 5001, text: "answer", reply: "q1" }),
    ]);
    await load();
    const before = await db.usageBytes();

    await db.appendRows([message({ id: "n1", time: 9000, text: "old news" })]);
    await vi.waitFor(async () => expect(await isBackfilling()).toBe(false), {
      timeout: 20_000,
      interval: 200,
    });
    expect((await find({ text: "old" }, { limit: 2000 })).hits).toHaveLength(
      1004,
    );
    expect(await ids({ text: "row 1002" })).toEqual(["o1002"]);
    expect(await ids({ aboutMe: true })).toEqual(["r1"]);
    expect(await db.usageBytes()).toBeGreaterThan(before);
  });

  it("finds rows the backfill has not reached yet", async () => {
    await seedV1([
      message({ id: "o1", time: 1, text: "legacy words", nick: "Carol" }),
      message({ id: "q1", time: 2, text: "ask", nick: "tester", own: true }),
      message({ id: "r1", time: 3, text: "reply", reply: "q1" }),
    ]);
    await load();

    const [byText, bySender, aboutMe] = await Promise.all([
      ids({ text: "legacy" }),
      ids({ from: "carol" }),
      ids({ aboutMe: true }),
    ]);
    expect(byText).toEqual(["o1"]);
    expect(bySender).toEqual(["o1"]);
    expect(aboutMe).toEqual(["r1"]);
  });
});

describe("performance smoke", () => {
  it("searches 20k rows", { timeout: 120_000 }, async () => {
    const words = ["alpha", "beta", "gamma", "delta", "omega", "sigma"];
    for (let batch = 0; batch < 20; batch++) {
      await db.appendRows(
        Array.from({ length: 1000 }, (_, i) => {
          const n = batch * 1000 + i;
          return message({
            id: `p${n}`,
            time: n,
            text: `${words[n % 6]} ${words[Math.floor(n / 6) % 6]} word${n % 997}`,
            target: `#c${n % 200}`,
          });
        }),
      );
    }
    for (const text of ["alpha", "word99", "gamma del"]) {
      const started = performance.now();
      const page = await find({ text });
      console.log(
        `search "${text}": ${page.hits.length} hits in ${(performance.now() - started).toFixed(1)} ms`,
      );
      expect(page.hits.length).toBeGreaterThan(0);
    }
  });
});
