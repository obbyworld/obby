import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewHistoryRow } from "../../../src/lib/history/historyDb";

type HistoryDb = typeof import("../../../src/lib/history/historyDb");

let db: HistoryDb;

function row(overrides: Partial<NewHistoryRow> = {}): NewHistoryRow {
  return {
    server: "s1",
    target: "#a",
    time: 1000,
    key: "k",
    raw: "x".repeat(36),
    ...overrides,
  };
}

const ROW_BYTES = 36 + 64;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  db = await import("../../../src/lib/history/historyDb");
});

describe("appendRows", () => {
  it("reports inserted rows and skips duplicates without double counting bytes", async () => {
    expect(await db.appendRows([row({ key: "a" }), row({ key: "b" })])).toEqual(
      [true, true],
    );
    expect(await db.usageBytes()).toBe(2 * ROW_BYTES);

    const result = await db.appendRows([
      row({ key: "a", raw: "different" }),
      row({ key: "c" }),
    ]);
    expect(result).toEqual([false, true]);
    expect(await db.usageBytes()).toBe(3 * ROW_BYTES);
    const rows = await db.newestEventRows("s1", "#a", 10);
    expect(rows.find((r) => r.key === "a")?.raw).toBe("x".repeat(36));
  });

  it("allows the same key in another conversation", async () => {
    expect(
      await db.appendRows([
        row(),
        row({ target: "#b" }),
        row({ server: "s2" }),
      ]),
    ).toEqual([true, true, true]);
  });
});

describe("event rows", () => {
  beforeEach(async () => {
    await db.appendRows([
      row({ key: "1", time: 1, msgid: "m1" }),
      row({ key: "2", time: 2, msgid: "m2" }),
      row({ key: "3", time: 3, msgid: "m3" }),
      row({ key: "3b", time: 3, msgid: "m3b" }),
      row({ key: "r", time: 3, ref: "m1" }),
      row({ key: "4", time: 4, msgid: "m4" }),
      row({ key: "other", time: 2, target: "#b" }),
    ]);
  });

  it("pages oldest-first, newest rows within the limit, ties by insertion", async () => {
    const page = await db.eventRowsBefore("s1", "#a", 3, 3);
    expect(page.map((r) => r.key)).toEqual(["2", "3", "3b"]);

    const older = await db.eventRowsBefore("s1", "#a", 2, 10);
    expect(older.map((r) => r.key)).toEqual(["1", "2"]);
  });

  it("excludes ref rows", async () => {
    const all = await db.newestEventRows("s1", "#a", 10);
    expect(all.map((r) => r.key)).toEqual(["1", "2", "3", "3b", "4"]);
  });

  it("returns the newest row", async () => {
    expect((await db.newestEventRows("s1", "#a", 1)).map((r) => r.key)).toEqual(
      ["4"],
    );
    expect(await db.newestEventRows("s1", "#none", 1)).toEqual([]);
  });

  it("pages newer rows oldest-first and resumes inside a shared millisecond", async () => {
    await db.appendRows([
      row({ key: "3c", time: 3, msgid: "m3c" }),
      row({ key: "3d", time: 3 }),
    ]);

    const first = await db.eventRowsAfter("s1", "#a", 2, 2);
    expect(first.map((r) => r.key)).toEqual(["2", "3"]);

    const last = first[first.length - 1];
    const next = await db.eventRowsAfter("s1", "#a", last.time, 2, last.id);
    expect(next.map((r) => r.key)).toEqual(["3b", "3c"]);

    const rest = await db.eventRowsAfter(
      "s1",
      "#a",
      next[1].time,
      10,
      next[1].id,
    );
    expect(rest.map((r) => r.key)).toEqual(["3d", "4"]);
  });
});

describe("refRowsFor", () => {
  it("returns ref rows for the given msgids oldest-first, from any target", async () => {
    await db.appendRows([
      row({ key: "m1", msgid: "m1", time: 1 }),
      row({ key: "r2", ref: "m2", time: 5 }),
      row({ key: "r1", ref: "m1", time: 3 }),
      row({ key: "r1b", ref: "m1", time: 4, target: "#b" }),
      row({ key: "r3", ref: "m3", time: 2 }),
      row({ key: "r1x", ref: "m1", time: 2, server: "s2" }),
    ]);
    const rows = await db.refRowsFor("s1", ["m1", "m2"]);
    expect(rows.map((r) => r.key)).toEqual(["r1", "r1b", "r2"]);
    expect(await db.refRowsFor("s1", [])).toEqual([]);
  });
});

describe("deleteMessage", () => {
  it("removes the message and its reactions and lowers bytes", async () => {
    await db.appendRows([
      row({ key: "m1", msgid: "m1", time: 1 }),
      row({ key: "m2", msgid: "m2", time: 2 }),
      row({ key: "r1", ref: "m1", time: 3 }),
      row({ key: "r1b", ref: "m1", time: 4, target: "#b" }),
      row({ key: "r2", ref: "m2", time: 5 }),
    ]);
    expect(await db.usageBytes()).toBe(5 * ROW_BYTES);

    await db.deleteMessage("s1", "#a", "m1");

    expect(
      (await db.newestEventRows("s1", "#a", 10)).map((r) => r.key),
    ).toEqual(["m2"]);
    expect(await db.refRowsFor("s1", ["m1"])).toEqual([]);
    expect((await db.refRowsFor("s1", ["m2"])).length).toBe(1);
    expect(await db.usageBytes()).toBe(2 * ROW_BYTES);
  });

  it("keeps same-msgid rows in other conversations", async () => {
    await db.appendRows([
      row({ key: "a", msgid: "m1" }),
      row({ key: "b", msgid: "m1", target: "#b" }),
    ]);
    await db.deleteMessage("s1", "#a", "m1");
    expect(await db.newestEventRows("s1", "#b", 10)).toHaveLength(1);
  });
});

describe("gaps", () => {
  it("adds, updates, lists and deletes", async () => {
    await db.addGap({
      server: "s1",
      target: "#a",
      from: 1,
      to: 2,
      lost: false,
    });
    await db.addGap({
      server: "s1",
      target: "#b",
      from: 1,
      to: 2,
      lost: false,
    });
    const [gap] = await db.gapsFor("s1", "#a");
    expect(gap).toMatchObject({ from: 1, to: 2, lost: false });
    expect(typeof gap.id).toBe("number");

    await db.updateGap({ ...gap, lost: true, to: 9 });
    expect(await db.gapsFor("s1", "#a")).toEqual([
      { ...gap, lost: true, to: 9 },
    ]);

    await db.deleteGap(gap.id);
    expect(await db.gapsFor("s1", "#a")).toEqual([]);
    expect(await db.gapsFor("s1", "#b")).toHaveLength(1);
  });
});

describe("pruneToLimit", () => {
  it("does nothing under the limit", async () => {
    await db.appendRows([row({ key: "a" }), row({ key: "b", time: 2 })]);
    await db.pruneToLimit(10 * ROW_BYTES);
    expect(await db.usageBytes()).toBe(2 * ROW_BYTES);
  });

  it("deletes oldest rows first down to 90% of the limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ key: `k${i}`, time: i + 1, target: i % 2 ? "#a" : "#b" }),
    );
    await db.appendRows(rows);
    await db.pruneToLimit(8 * ROW_BYTES);

    // 90% of 8 rows is 7.2 rows, so 7 rows remain: the newest.
    expect(await db.usageBytes()).toBe(7 * ROW_BYTES);
    const remaining = [
      ...(await db.newestEventRows("s1", "#a", 20)),
      ...(await db.newestEventRows("s1", "#b", 20)),
    ].map((r) => r.time);
    expect(remaining.sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it("drops gaps older than the oldest remaining row and gaps of emptied conversations", async () => {
    await db.appendRows([
      row({ key: "a1", time: 1 }),
      row({ key: "a2", time: 10 }),
      row({ key: "a3", time: 11 }),
      row({ key: "b1", time: 2, target: "#b" }),
    ]);
    const gap = { server: "s1", target: "#a", lost: false };
    await db.addGap({ ...gap, from: 0, to: 5 });
    await db.addGap({ ...gap, from: 12, to: 13 });
    await db.addGap({ ...gap, target: "#b", from: 0, to: 1 });

    await db.pruneToLimit(3 * ROW_BYTES);

    expect(await db.usageBytes()).toBe(2 * ROW_BYTES);
    expect(await db.gapsFor("s1", "#a")).toMatchObject([{ from: 12, to: 13 }]);
    expect(await db.gapsFor("s1", "#b")).toEqual([]);
  });
});

describe("deleteServerHistory", () => {
  it("removes only that server's rows and gaps", async () => {
    await db.appendRows([
      row({ key: "a" }),
      row({ key: "b", target: "#b" }),
      row({ key: "c", server: "s2" }),
    ]);
    await db.addGap({
      server: "s1",
      target: "#a",
      from: 1,
      to: 2,
      lost: false,
    });
    await db.addGap({
      server: "s2",
      target: "#a",
      from: 1,
      to: 2,
      lost: false,
    });

    await db.deleteServerHistory("s1");

    expect(await db.newestEventRows("s1", "#a", 10)).toEqual([]);
    expect(await db.newestEventRows("s1", "#b", 10)).toEqual([]);
    expect(await db.newestEventRows("s2", "#a", 10)).toHaveLength(1);
    expect(await db.gapsFor("s1", "#a")).toEqual([]);
    expect(await db.gapsFor("s2", "#a")).toHaveLength(1);
    expect(await db.usageBytes()).toBe(ROW_BYTES);
  });
});

describe("clearHistory", () => {
  it("empties everything and resets usage", async () => {
    await db.appendRows([row()]);
    await db.addGap({
      server: "s1",
      target: "#a",
      from: 1,
      to: 2,
      lost: false,
    });
    await db.clearHistory();
    expect(await db.usageBytes()).toBe(0);
    expect(await db.newestEventRows("s1", "#a", 10)).toEqual([]);
    expect(await db.gapsFor("s1", "#a")).toEqual([]);
  });
});

describe("ordering", () => {
  it("runs back to back calls in call order", async () => {
    const first = db.appendRows([row({ key: "a" })]);
    const read = db.newestEventRows("s1", "#a", 10);
    const second = db.appendRows([row({ key: "b", time: 2000 })]);
    const readAgain = db.newestEventRows("s1", "#a", 10);
    const cleared = db.clearHistory();
    const readEmpty = db.newestEventRows("s1", "#a", 10);

    await Promise.all([first, second, cleared]);
    expect((await read).map((r) => r.key)).toEqual(["a"]);
    expect((await readAgain).map((r) => r.key)).toEqual(["a", "b"]);
    expect(await readEmpty).toEqual([]);
  });

  it("keeps the chain alive after a failing operation", async () => {
    await expect(
      db.appendRows([{ ...row(), raw: (() => 1) as unknown as string }]),
    ).rejects.toBeDefined();
    expect(await db.appendRows([row()])).toEqual([true]);
  });
});

describe("other tabs", () => {
  it("closes for a newer tab and reopens on the next call", async () => {
    await db.appendRows([row({ key: "a" })]);

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("obby-history");
      request.onblocked = () => reject(new Error("blocked"));
      request.onsuccess = () => resolve();
    });

    expect(await db.appendRows([row({ key: "b" })])).toEqual([true]);
    expect(
      (await db.newestEventRows("s1", "#a", 10)).map((r) => r.key),
    ).toEqual(["b"]);
  });

  it("fails while an older tab blocks the upgrade, then opens", async () => {
    const older = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("obby-history", 1);
      open.onupgradeneeded = () => {
        const rows = open.result.createObjectStore("rows", {
          keyPath: "id",
          autoIncrement: true,
        });
        rows.createIndex("conv", ["server", "target", "time"]);
        rows.createIndex("dedupe", ["server", "target", "key"], {
          unique: true,
        });
        rows.createIndex("time", "time");
        rows.createIndex("server", "server");
        rows.createIndex("ref", ["server", "ref"]);
        rows.createIndex("msgid", ["server", "target", "msgid"]);
        open.result
          .createObjectStore("gaps", { keyPath: "id", autoIncrement: true })
          .createIndex("conv", ["server", "target"]);
        open.result.createObjectStore("meta", { keyPath: "name" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });

    await expect(db.usageBytes()).rejects.toThrow("blocked");
    older.close();

    expect(await db.appendRows([row()])).toEqual([true]);
  });
});

// The database as an older release left it, with one gap that release
// marked lost.
async function openOlderRelease(version: 1 | 2) {
  await db.usageBytes();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("obby-history");
    request.onblocked = () => reject(new Error("blocked"));
    request.onsuccess = () => resolve();
  });
  const older = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("obby-history", version);
    open.onupgradeneeded = () => {
      const rows = open.result.createObjectStore("rows", {
        keyPath: "id",
        autoIncrement: true,
      });
      rows.createIndex("conv", ["server", "target", "time"]);
      rows.createIndex("dedupe", ["server", "target", "key"], {
        unique: true,
      });
      rows.createIndex("time", "time");
      rows.createIndex("server", "server");
      rows.createIndex("ref", ["server", "ref"]);
      rows.createIndex("msgid", ["server", "target", "msgid"]);
      const gaps = open.result.createObjectStore("gaps", {
        keyPath: "id",
        autoIncrement: true,
      });
      gaps.createIndex("conv", ["server", "target"]);
      gaps.add({ server: "s1", target: "#a", from: 1, to: 2, lost: true });
      open.result.createObjectStore("meta", { keyPath: "name" });
      if (version === 2) {
        rows.createIndex("nick", ["nick", "time"]);
        rows.createIndex("serverTime", ["server", "time"]);
        rows.createIndex("reply", ["server", "target", "replyTo"]);
        rows.createIndex("replyToOwn", ["replyToOwn", "time"]);
        open.result.createObjectStore("terms", {
          keyPath: ["term", "time", "rowId"],
        });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  older.close();
}

describe("upgrade", () => {
  it.each([1, 2] as const)(
    "reopens gaps that version %i marked lost",
    async (version) => {
      await openOlderRelease(version);

      expect(await db.fillableGaps()).toEqual([
        expect.objectContaining({ server: "s1", target: "#a", lost: false }),
      ]);
    },
  );
});

describe("without indexedDB", () => {
  it("resolves to empty results", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: removing the global for this case
    (globalThis as any).indexedDB = undefined;
    vi.resetModules();
    const bare = await import("../../../src/lib/history/historyDb");
    expect(await bare.appendRows([row()])).toEqual([false]);
    expect(await bare.newestEventRows("s1", "#a", 5)).toEqual([]);
    expect(await bare.usageBytes()).toBe(0);
    await expect(bare.clearHistory()).resolves.toBeUndefined();
  });
});
