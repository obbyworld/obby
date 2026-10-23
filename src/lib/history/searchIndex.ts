import type { HistoryRow, NewHistoryRow } from "./historyDb";
import { addBytes, awaitRequest, META, ROWS, TERMS } from "./idb";
import { searchFieldsOf, termsOf } from "./searchFields";

const BACKFILL = "searchBackfill";
const BACKFILL_CHUNK = 500;
const ROW_OVERHEAD = 64;
const TERM_OVERHEAD = 48;

export async function isOwnMessage(
  rows: IDBObjectStore,
  server: string,
  target: string,
  msgid: string,
): Promise<boolean> {
  const found = await awaitRequest<HistoryRow[]>(
    rows.index("msgid").getAll(IDBKeyRange.only([server, target, msgid])),
  );
  return found.some(
    (row) =>
      row.ref === undefined &&
      (row.text === undefined ? searchFieldsOf(row.raw).isOwn : !!row.isOwn),
  );
}

// We flag a reply to our own message on whichever of the two rows we write
// last, since a history page can deliver the reply before the message.
export async function withSearchColumns<T extends NewHistoryRow>(
  rows: IDBObjectStore,
  row: T,
): Promise<{ record: T & Partial<HistoryRow>; terms: string[] }> {
  if (row.ref !== undefined) return { record: row, terms: [] };
  const { nick, text, hasLink, isOwn, replyTo } = searchFieldsOf(row.raw);
  const repliesToOwn =
    !!replyTo && (await isOwnMessage(rows, row.server, row.target, replyTo));
  return {
    record: {
      ...row,
      nick: nick.toLowerCase(),
      text,
      ...(hasLink ? { hasLink: true } : {}),
      ...(isOwn ? { isOwn: true } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(repliesToOwn ? { replyToOwn: 1 } : {}),
    },
    terms: termsOf(text),
  };
}

export function rowBytes(record: Partial<HistoryRow>, terms: string[]): number {
  return (
    (record.raw?.length ?? 0) +
    (record.text?.length ?? 0) +
    ROW_OVERHEAD +
    terms.reduce((sum, term) => sum + term.length + TERM_OVERHEAD, 0)
  );
}

export async function indexRow(
  tx: IDBTransaction,
  row: NewHistoryRow & Partial<HistoryRow>,
  rowId: number,
  terms: string[],
): Promise<void> {
  const termStore = tx.objectStore(TERMS);
  for (const term of terms) termStore.put({ term, time: row.time, rowId });
  if (!row.isOwn || !row.msgid) return;
  const rows = tx.objectStore(ROWS);
  const replies = await awaitRequest<HistoryRow[]>(
    rows
      .index("reply")
      .getAll(IDBKeyRange.only([row.server, row.target, row.msgid])),
  );
  for (const reply of replies)
    if (!reply.replyToOwn) rows.put({ ...reply, replyToOwn: 1 });
}

export function unindexRow(tx: IDBTransaction, row: HistoryRow): void {
  if (row.text === undefined) return;
  const termStore = tx.objectStore(TERMS);
  for (const term of termsOf(row.text))
    termStore.delete([term, row.time, row.id]);
}

export function startBackfill(tx: IDBTransaction): void {
  tx.objectStore(META).put({ name: BACKFILL, value: 0 });
}

export async function isBackfilling(tx: IDBTransaction): Promise<boolean> {
  return (
    (await awaitRequest(tx.objectStore(META).getKey(BACKFILL))) !== undefined
  );
}

// Rows written before the search index existed get indexed in small chunks
// between normal reads and writes, resuming from the last row id on restart.
export async function backfillChunk(tx: IDBTransaction): Promise<boolean> {
  const meta = tx.objectStore(META);
  const progress = await awaitRequest<{ value: number } | undefined>(
    meta.get(BACKFILL),
  );
  if (!progress) return false;
  const store = tx.objectStore(ROWS);
  const rows = await awaitRequest<HistoryRow[]>(
    store.getAll(IDBKeyRange.lowerBound(progress.value, true), BACKFILL_CHUNK),
  );
  let added = 0;
  for (const row of rows) {
    if (row.ref !== undefined || row.text !== undefined) continue;
    const { record, terms } = await withSearchColumns(store, row);
    const bytes = rowBytes(record, terms);
    added += bytes - row.bytes;
    await awaitRequest(store.put({ ...record, bytes }));
    await indexRow(tx, record, row.id, terms);
  }
  await addBytes(tx, added);
  const hasMore = rows.length === BACKFILL_CHUNK;
  if (hasMore)
    await awaitRequest(
      meta.put({ name: BACKFILL, value: rows[rows.length - 1].id }),
    );
  else await awaitRequest(meta.delete(BACKFILL));
  return hasMore;
}

// Senders we have saved messages from, read one name at a time from the nick
// index by jumping past each name's rows.
export function readSavedSenders(
  tx: IDBTransaction,
  limit: number,
): Promise<string[]> {
  const nicks: string[] = [];
  return new Promise<string[]>((resolve, reject) => {
    const request = tx.objectStore(ROWS).index("nick").openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || nicks.length >= limit) return resolve(nicks);
      const [nick] = cursor.key as [string, number];
      if (nick) nicks.push(nick);
      cursor.continue([nick, Number.POSITIVE_INFINITY]);
    };
    request.onerror = () => reject(request.error);
  });
}
