export interface HistoryRow {
  id: number;
  server: string;
  target: string;
  time: number;
  key: string;
  msgid?: string;
  ref?: string;
  raw: string;
  bytes: number;
}

export interface HistoryGap {
  id: number;
  server: string;
  target: string;
  from: number;
  to: number;
  lost: boolean;
}

export type NewHistoryRow = Omit<HistoryRow, "id" | "bytes">;

const ROWS = "rows";
const GAPS = "gaps";
const META = "meta";
const ROW_OVERHEAD = 64;
const PRUNE_TARGET = 0.9;
const QUOTA_RETRY_TARGET = 0.8;

let dbPromise: Promise<IDBDatabase> | undefined;
let chain: Promise<unknown> = Promise.resolve();

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("obby-history", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const rows = db.createObjectStore(ROWS, {
        keyPath: "id",
        autoIncrement: true,
      });
      rows.createIndex("conv", ["server", "target", "time"]);
      rows.createIndex("dedupe", ["server", "target", "key"], { unique: true });
      rows.createIndex("time", "time");
      rows.createIndex("server", "server");
      rows.createIndex("ref", ["server", "ref"]);
      rows.createIndex("msgid", ["server", "target", "msgid"]);
      const gaps = db.createObjectStore(GAPS, {
        keyPath: "id",
        autoIncrement: true,
      });
      gaps.createIndex("conv", ["server", "target"]);
      db.createObjectStore(META, { keyPath: "name" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  }).catch((error: unknown) => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

function enqueue<T>(
  fallback: T,
  op: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") return Promise.resolve(fallback);
  const result = chain.then(openDb).then(op);
  chain = result.catch(() => undefined);
  return result;
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function inTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
    fn(tx).then(
      (value) => {
        result = value;
      },
      (error: unknown) => reject(error),
    );
  });
}

function walk(
  source: IDBIndex | IDBObjectStore,
  range: IDBKeyRange | undefined,
  direction: IDBCursorDirection,
  visit: (cursor: IDBCursorWithValue) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(range, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && visit(cursor)) cursor.continue();
      else resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

async function readBytes(tx: IDBTransaction): Promise<number> {
  const current = await awaitRequest<{ value: number } | undefined>(
    tx.objectStore(META).get("bytes"),
  );
  return current?.value ?? 0;
}

async function addBytes(tx: IDBTransaction, delta: number): Promise<void> {
  const value = (await readBytes(tx)) + delta;
  await awaitRequest(tx.objectStore(META).put({ name: "bytes", value }));
}

function convRange(server: string, target: string, from: number, to: number) {
  return IDBKeyRange.bound([server, target, from], [server, target, to]);
}

const wholeServer = (server: string) =>
  IDBKeyRange.bound([server], [server, []]);

function insertRows(
  db: IDBDatabase,
  rows: NewHistoryRow[],
): Promise<boolean[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ROWS, META], "readwrite");
    const store = tx.objectStore(ROWS);
    const inserted: boolean[] = rows.map(() => false);
    let added = 0;
    rows.forEach((row, index) => {
      const bytes = row.raw.length + ROW_OVERHEAD;
      const request = store.add({ ...row, bytes });
      request.onsuccess = () => {
        inserted[index] = true;
        added += bytes;
      };
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") event.preventDefault();
      };
    });
    // Requests run in order, so this read fires after every add above settled.
    const meta = tx.objectStore(META);
    const current = meta.get("bytes");
    current.onsuccess = () => {
      const value = (current.result?.value ?? 0) + added;
      meta.put({ name: "bytes", value });
    };
    tx.oncomplete = () => resolve(inserted);
    tx.onabort = () => reject(tx.error);
  });
}

function rowsBefore(
  db: IDBDatabase,
  server: string,
  target: string,
  beforeTime: number,
  limit: number,
): Promise<HistoryRow[]> {
  return inTx(db, [ROWS], "readonly", async (tx) => {
    const found: HistoryRow[] = [];
    if (limit > 0) {
      const index = tx.objectStore(ROWS).index("conv");
      const range = convRange(
        server,
        target,
        Number.NEGATIVE_INFINITY,
        beforeTime,
      );
      await walk(index, range, "prev", (cursor) => {
        const row = cursor.value as HistoryRow;
        if (row.ref === undefined) found.push(row);
        return found.length < limit;
      });
    }
    return found.reverse();
  });
}

function deleteRows(tx: IDBTransaction, rows: HistoryRow[]): Promise<void> {
  const store = tx.objectStore(ROWS);
  for (const row of rows) store.delete(row.id);
  return addBytes(tx, -rows.reduce((sum, row) => sum + row.bytes, 0));
}

function usageDb(db: IDBDatabase): Promise<number> {
  return inTx(db, [META], "readonly", readBytes);
}

function pruneDb(db: IDBDatabase, targetBytes: number): Promise<void> {
  return inTx(db, [ROWS, GAPS, META], "readwrite", async (tx) => {
    let remaining = await readBytes(tx);
    const rows = tx.objectStore(ROWS);
    await walk(rows.index("time"), undefined, "next", (cursor) => {
      if (remaining <= targetBytes) return false;
      remaining -= (cursor.value as HistoryRow).bytes;
      cursor.delete();
      return true;
    });
    await awaitRequest(
      tx.objectStore(META).put({ name: "bytes", value: remaining }),
    );

    const gaps = tx.objectStore(GAPS);
    const conv = rows.index("conv");
    for (const gap of await awaitRequest<HistoryGap[]>(gaps.getAll())) {
      const range = convRange(
        gap.server,
        gap.target,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      const oldest = await awaitRequest(conv.openCursor(range));
      if (!oldest || gap.to < (oldest.value as HistoryRow).time) {
        gaps.delete(gap.id);
      }
    }
  });
}

export function appendRows(rows: NewHistoryRow[]): Promise<boolean[]> {
  return enqueue(
    rows.map(() => false),
    async (db) => {
      try {
        return await insertRows(db, rows);
      } catch (error) {
        const quotaExceeded =
          error instanceof DOMException && error.name === "QuotaExceededError";
        if (!quotaExceeded) throw error;
        await pruneDb(db, (await usageDb(db)) * QUOTA_RETRY_TARGET);
        return insertRows(db, rows);
      }
    },
  );
}

export function eventRowsBefore(
  server: string,
  target: string,
  beforeTime: number,
  limit: number,
): Promise<HistoryRow[]> {
  return enqueue([], (db) => rowsBefore(db, server, target, beforeTime, limit));
}

export function newestEventRows(
  server: string,
  target: string,
  limit: number,
): Promise<HistoryRow[]> {
  return eventRowsBefore(server, target, Number.POSITIVE_INFINITY, limit);
}

export function refRowsFor(
  server: string,
  msgids: string[],
): Promise<HistoryRow[]> {
  return enqueue([], (db) =>
    inTx(db, [ROWS], "readonly", async (tx) => {
      const index = tx.objectStore(ROWS).index("ref");
      const found: HistoryRow[] = [];
      for (const msgid of msgids) {
        found.push(
          ...(await awaitRequest<HistoryRow[]>(
            index.getAll(IDBKeyRange.only([server, msgid])),
          )),
        );
      }
      return found.sort((a, b) => a.time - b.time || a.id - b.id);
    }),
  );
}

export function deleteMessage(
  server: string,
  target: string,
  msgid: string,
): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [ROWS, META], "readwrite", async (tx) => {
      const rows = tx.objectStore(ROWS);
      const events = await awaitRequest<HistoryRow[]>(
        rows.index("msgid").getAll(IDBKeyRange.only([server, target, msgid])),
      );
      const reactions = await awaitRequest<HistoryRow[]>(
        rows.index("ref").getAll(IDBKeyRange.only([server, msgid])),
      );
      const doomed = new Map<number, HistoryRow>();
      for (const row of [...events.filter((row) => !row.ref), ...reactions]) {
        doomed.set(row.id, row);
      }
      await deleteRows(tx, [...doomed.values()]);
    }),
  );
}

export function gapsFor(server: string, target: string): Promise<HistoryGap[]> {
  return enqueue([], (db) =>
    inTx(db, [GAPS], "readonly", (tx) =>
      awaitRequest<HistoryGap[]>(
        tx
          .objectStore(GAPS)
          .index("conv")
          .getAll(IDBKeyRange.only([server, target])),
      ),
    ),
  );
}

export function addGap(gap: Omit<HistoryGap, "id">): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [GAPS], "readwrite", async (tx) => {
      await awaitRequest(tx.objectStore(GAPS).add(gap));
    }),
  );
}

export function updateGap(gap: HistoryGap): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [GAPS], "readwrite", async (tx) => {
      await awaitRequest(tx.objectStore(GAPS).put(gap));
    }),
  );
}

export function deleteGap(id: number): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [GAPS], "readwrite", async (tx) => {
      await awaitRequest(tx.objectStore(GAPS).delete(id));
    }),
  );
}

export function usageBytes(): Promise<number> {
  return enqueue(0, usageDb);
}

export async function pruneToLimit(limitBytes: number): Promise<void> {
  return enqueue(undefined, async (db) => {
    if ((await usageDb(db)) > limitBytes) {
      await pruneDb(db, limitBytes * PRUNE_TARGET);
    }
  });
}

export function hasServerHistory(server: string): Promise<boolean> {
  return enqueue(false, (db) =>
    inTx(db, [ROWS], "readonly", async (tx) => {
      const count = await awaitRequest<number>(
        tx.objectStore(ROWS).index("server").count(server),
      );
      return count > 0;
    }),
  );
}

export function deleteServerHistory(server: string): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [ROWS, GAPS, META], "readwrite", async (tx) => {
      let freed = 0;
      await walk(
        tx.objectStore(ROWS).index("server"),
        IDBKeyRange.only(server),
        "next",
        (cursor) => {
          freed += (cursor.value as HistoryRow).bytes;
          cursor.delete();
          return true;
        },
      );
      await addBytes(tx, -freed);
      await walk(
        tx.objectStore(GAPS).index("conv"),
        wholeServer(server),
        "next",
        (cursor) => {
          cursor.delete();
          return true;
        },
      );
      await awaitRequest(tx.objectStore(META).delete(parkedName(server)));
    }),
  );
}

const PARKED_PREFIX = "parked:";
const parkedName = (server: string) => `${PARKED_PREFIX}${server}`;

interface ParkedHistory {
  name: string;
  value: { address: string; at: number };
}

// A removed server's history waits under its old id until a server with the
// same address is added, which then takes it over.
export function parkServerHistory(
  server: string,
  address: string,
): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [META], "readwrite", async (tx) => {
      await awaitRequest(
        tx.objectStore(META).put({
          name: parkedName(server),
          value: { address, at: Date.now() },
        }),
      );
    }),
  );
}

export function adoptParkedHistory(
  address: string,
  server: string,
): Promise<boolean> {
  return enqueue(false, (db) =>
    inTx(db, [ROWS, GAPS, META], "readwrite", async (tx) => {
      const meta = tx.objectStore(META);
      const parked = (
        await awaitRequest<ParkedHistory[]>(
          meta.getAll(
            IDBKeyRange.bound(PARKED_PREFIX, `${PARKED_PREFIX}\uffff`),
          ),
        )
      )
        .filter((entry) => entry.value.address === address)
        .sort((a, b) => b.value.at - a.value.at)[0];
      if (!parked) return false;
      const from = parked.name.slice(PARKED_PREFIX.length);
      await addBytes(tx, -(await moveRows(tx, from, server)));
      await walk(
        tx.objectStore(GAPS).index("conv"),
        wholeServer(from),
        "next",
        (cursor) => {
          cursor.update({ ...(cursor.value as HistoryGap), server });
          return true;
        },
      );
      await awaitRequest(meta.delete(parked.name));
      return true;
    }),
  );
}

// Moves every row of one server to another and returns the bytes of the
// duplicates we dropped on the way.
function moveRows(
  tx: IDBTransaction,
  from: string,
  to: string,
): Promise<number> {
  const rows = tx.objectStore(ROWS);
  const dedupe = rows.index("dedupe");
  let freed = 0;
  return new Promise((resolve, reject) => {
    const request = rows.index("server").openCursor(IDBKeyRange.only(from));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(freed);
      const row = cursor.value as HistoryRow;
      const clash = dedupe.getKey([to, row.target, row.key]);
      clash.onsuccess = () => {
        if (clash.result === undefined) cursor.update({ ...row, server: to });
        else {
          freed += row.bytes;
          cursor.delete();
        }
        cursor.continue();
      };
      clash.onerror = () => reject(clash.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export function clearHistory(): Promise<void> {
  return enqueue(undefined, (db) =>
    inTx(db, [ROWS, GAPS, META], "readwrite", async (tx) => {
      await Promise.all([
        awaitRequest(tx.objectStore(ROWS).clear()),
        awaitRequest(tx.objectStore(GAPS).clear()),
        awaitRequest(tx.objectStore(META).clear()),
      ]);
      await Promise.all([
        awaitRequest(tx.objectStore(META).put({ name: "bytes", value: 0 })),
      ]);
    }),
  );
}
