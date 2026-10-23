import {
  addBytes,
  awaitRequest,
  GAPS,
  META,
  ROWS,
  readBytes,
  TERMS,
} from "./idb";
import {
  backfillChunk,
  indexRow,
  isBackfilling,
  readSavedSenders,
  rowBytes,
  startBackfill,
  unindexRow,
  withSearchColumns,
} from "./searchIndex";

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
  nick?: string;
  text?: string;
  hasLink?: true;
  isOwn?: true;
  replyTo?: string;
  replyToOwn?: 1;
}

type SearchColumn =
  | "nick"
  | "text"
  | "hasLink"
  | "isOwn"
  | "replyTo"
  | "replyToOwn";

export interface HistoryGap {
  id: number;
  server: string;
  target: string;
  from: number;
  to: number;
  lost: boolean;
}

export type NewHistoryRow = Omit<HistoryRow, "id" | "bytes" | SearchColumn>;

const PRUNE_TARGET = 0.9;
const QUOTA_RETRY_TARGET = 0.8;

let dbPromise: Promise<IDBDatabase> | undefined;
let chain: Promise<unknown> = Promise.resolve();

function createV1(db: IDBDatabase) {
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
}

function createV2(db: IDBDatabase, tx: IDBTransaction) {
  const rows = tx.objectStore(ROWS);
  rows.createIndex("nick", ["nick", "time"]);
  rows.createIndex("serverTime", ["server", "time"]);
  rows.createIndex("reply", ["server", "target", "replyTo"]);
  rows.createIndex("replyToOwn", ["replyToOwn", "time"]);
  db.createObjectStore(TERMS, { keyPath: ["term", "time", "rowId"] });
}

// Versions 1 and 2 marked a gap lost whenever the server returned a short
// page, which servers do for many reasons, so we let the server answer again.
function reopenLostGaps(tx: IDBTransaction) {
  const cursorRequest = tx.objectStore(GAPS).openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (cursor.value.lost) cursor.update({ ...cursor.value, lost: false });
    cursor.continue();
  };
}

function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) createV1(db);
  if (oldVersion < 2) createV2(db, tx);
  if (oldVersion === 1) startBackfill(tx);
  if (oldVersion >= 1 && oldVersion < 3) reopenLostGaps(tx);
}

// Another tab on an older version blocks our upgrade until it closes, so we
// fail this call and open again on the next one. We close our connection when
// a newer tab asks to upgrade, and reopen on the next call.
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const forget = () => {
    if (dbPromise === opening) dbPromise = undefined;
  };
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("obby-history", 3);
    let isBlocked = false;
    open.onupgradeneeded = (event) =>
      upgrade(
        open.result,
        open.transaction as IDBTransaction,
        event.oldVersion,
      );
    open.onblocked = () => {
      isBlocked = true;
      reject(new DOMException("history database is blocked", "AbortError"));
    };
    open.onsuccess = () => {
      const db = open.result;
      if (isBlocked) return db.close();
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
      setTimeout(continueBackfill, 0);
    };
    open.onerror = () => reject(open.error);
  }).catch((error: unknown) => {
    forget();
    throw error;
  });
  dbPromise = opening;
  return opening;
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

export function whenHistoryIdle(): Promise<void> {
  return chain.then(() => undefined);
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

function convRange(server: string, target: string, from: number, to: number) {
  return IDBKeyRange.bound([server, target, from], [server, target, to]);
}

const wholeServer = (server: string) =>
  IDBKeyRange.bound([server], [server, []]);

function addUnlessDuplicate(
  store: IDBObjectStore,
  value: unknown,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.add(value);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = (event) => {
      if (request.error?.name !== "ConstraintError")
        return reject(request.error);
      event.preventDefault();
      resolve(undefined);
    };
  });
}

function insertRows(
  db: IDBDatabase,
  rows: NewHistoryRow[],
): Promise<boolean[]> {
  return inTx(db, [ROWS, TERMS, META], "readwrite", async (tx) => {
    const store = tx.objectStore(ROWS);
    const inserted: boolean[] = [];
    let added = 0;
    for (const row of rows) {
      const { record, terms } = await withSearchColumns(store, row);
      const bytes = rowBytes(record, terms);
      const id = await addUnlessDuplicate(store, { ...record, bytes });
      inserted.push(id !== undefined);
      if (id === undefined) continue;
      added += bytes;
      await indexRow(tx, record, id, terms);
    }
    await addBytes(tx, added);
    return inserted;
  });
}

function continueBackfill() {
  void enqueue(false, (db) =>
    inTx(db, [ROWS, TERMS, META], "readwrite", backfillChunk),
  ).then((hasMore) => {
    if (hasMore) setTimeout(continueBackfill, 0);
  });
}

export function readSearchIndex<T>(
  fallback: T,
  read: (
    rows: IDBObjectStore,
    terms: IDBObjectStore,
    isIndexing: boolean,
  ) => Promise<T>,
): Promise<T> {
  return enqueue(fallback, (db) =>
    inTx(db, [ROWS, TERMS, META], "readonly", async (tx) =>
      read(
        tx.objectStore(ROWS),
        tx.objectStore(TERMS),
        await isBackfilling(tx),
      ),
    ),
  );
}

function eventRows(
  db: IDBDatabase,
  range: IDBKeyRange,
  direction: IDBCursorDirection,
  limit: number,
  skip: (row: HistoryRow) => boolean = () => false,
): Promise<HistoryRow[]> {
  return inTx(db, [ROWS], "readonly", async (tx) => {
    const found: HistoryRow[] = [];
    if (limit > 0) {
      const index = tx.objectStore(ROWS).index("conv");
      await walk(index, range, direction, (cursor) => {
        const row = cursor.value as HistoryRow;
        if (row.ref === undefined && !skip(row)) found.push(row);
        return found.length < limit;
      });
    }
    return found;
  });
}

function deleteRows(tx: IDBTransaction, rows: HistoryRow[]): Promise<void> {
  const store = tx.objectStore(ROWS);
  for (const row of rows) {
    store.delete(row.id);
    unindexRow(tx, row);
  }
  return addBytes(tx, -rows.reduce((sum, row) => sum + row.bytes, 0));
}

function usageDb(db: IDBDatabase): Promise<number> {
  return inTx(db, [META], "readonly", readBytes);
}

function pruneDb(db: IDBDatabase, targetBytes: number): Promise<void> {
  return inTx(db, [ROWS, GAPS, META, TERMS], "readwrite", async (tx) => {
    let remaining = await readBytes(tx);
    const rows = tx.objectStore(ROWS);
    await walk(rows.index("time"), undefined, "next", (cursor) => {
      if (remaining <= targetBytes) return false;
      const row = cursor.value as HistoryRow;
      remaining -= row.bytes;
      unindexRow(tx, row);
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
  return enqueue([], async (db) =>
    (
      await eventRows(
        db,
        convRange(server, target, Number.NEGATIVE_INFINITY, beforeTime),
        "prev",
        limit,
      )
    ).reverse(),
  );
}

// Rows from afterTime on, oldest first. Rows sharing a millisecond come in id
// order, so passing the id of the last row we have resumes right after it.
export function eventRowsAfter(
  server: string,
  target: string,
  afterTime: number,
  limit: number,
  afterId?: number,
): Promise<HistoryRow[]> {
  return enqueue([], (db) =>
    eventRows(
      db,
      convRange(server, target, afterTime, Number.POSITIVE_INFINITY),
      "next",
      limit,
      (row) =>
        afterId !== undefined && row.time === afterTime && row.id <= afterId,
    ),
  );
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
    inTx(db, [ROWS, META, TERMS], "readwrite", async (tx) => {
      const rows = tx.objectStore(ROWS);
      const events = await awaitRequest<HistoryRow[]>(
        rows.index("msgid").getAll(IDBKeyRange.only([server, target, msgid])),
      );
      await deleteWithReactions(tx, server, events, [msgid]);
    }),
  );
}

// A message redacted while we were away is gone from the server's history and
// no REDACT reaches us, so we drop saved messages a page skipped inside its span.
export function deleteMessagesMissingFromPage(
  server: string,
  target: string,
  from: number,
  to: number,
  kept: string[],
): Promise<void> {
  if (to - from < 2) return Promise.resolve();
  const keptIds = new Set(kept);
  return enqueue(undefined, (db) =>
    inTx(db, [ROWS, META, TERMS], "readwrite", async (tx) => {
      const inside = await awaitRequest<HistoryRow[]>(
        tx
          .objectStore(ROWS)
          .index("conv")
          .getAll(convRange(server, target, from + 1, to - 1)),
      );
      const missing = inside.filter(
        (row) => !row.ref && row.msgid && !keptIds.has(row.msgid),
      );
      await deleteWithReactions(
        tx,
        server,
        missing,
        missing.map((row) => row.msgid ?? ""),
      );
    }),
  );
}

async function deleteWithReactions(
  tx: IDBTransaction,
  server: string,
  events: HistoryRow[],
  msgids: string[],
): Promise<void> {
  const refIndex = tx.objectStore(ROWS).index("ref");
  const doomed = new Map<number, HistoryRow>();
  for (const row of events.filter((row) => !row.ref)) doomed.set(row.id, row);
  for (const msgid of msgids) {
    const reactions = await awaitRequest<HistoryRow[]>(
      refIndex.getAll(IDBKeyRange.only([server, msgid])),
    );
    for (const reaction of reactions) doomed.set(reaction.id, reaction);
  }
  await deleteRows(tx, [...doomed.values()]);
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

export async function fillableGaps(): Promise<HistoryGap[]> {
  const gaps = await enqueue<HistoryGap[]>([], (db) =>
    inTx(db, [GAPS], "readonly", (tx) =>
      awaitRequest<HistoryGap[]>(tx.objectStore(GAPS).getAll()),
    ),
  );
  return gaps.filter((gap) => !gap.lost);
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

export function savedSenders(limit = 2000): Promise<string[]> {
  return enqueue([], (db) =>
    inTx(db, [ROWS], "readonly", (tx) => readSavedSenders(tx, limit)),
  );
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
    inTx(db, [ROWS, GAPS, META, TERMS], "readwrite", async (tx) => {
      let freed = 0;
      await walk(
        tx.objectStore(ROWS).index("server"),
        IDBKeyRange.only(server),
        "next",
        (cursor) => {
          const row = cursor.value as HistoryRow;
          freed += row.bytes;
          unindexRow(tx, row);
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
    inTx(db, [ROWS, META], "readwrite", async (tx) => {
      const rowCount = await awaitRequest<number>(
        tx.objectStore(ROWS).index("server").count(server),
      );
      if (rowCount === 0) return;
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
    inTx(db, [ROWS, GAPS, META, TERMS], "readwrite", async (tx) => {
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
// duplicates we dropped on the way. Search terms point at row ids, so only
// the dropped rows touch them.
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
          unindexRow(tx, row);
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
    inTx(db, [ROWS, GAPS, META, TERMS], "readwrite", async (tx) => {
      await Promise.all([
        awaitRequest(tx.objectStore(ROWS).clear()),
        awaitRequest(tx.objectStore(GAPS).clear()),
        awaitRequest(tx.objectStore(META).clear()),
        awaitRequest(tx.objectStore(TERMS).clear()),
      ]);
      await Promise.all([
        awaitRequest(tx.objectStore(META).put({ name: "bytes", value: 0 })),
      ]);
    }),
  );
}
