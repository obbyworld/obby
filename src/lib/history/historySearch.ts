import type {
  SearchHit,
  SearchPage,
  SearchQuery,
  SearchScope,
} from "../search/searchTypes";
import { type HistoryRow, readSearchIndex } from "./historyDb";
import { awaitRequest } from "./idb";
import {
  indexTermOf,
  matchesTerms,
  mentionsNick,
  type QueryTerms,
  queryTermsOf,
  searchFieldsOf,
  senderOf,
  termsOf,
} from "./searchFields";
import { isOwnMessage } from "./searchIndex";

const DEFAULT_LIMIT = 50;
const FETCH_CHUNK = 100;
const LAST_CHAR = String.fromCharCode(0xffff);
const INTERSECT_CAP = 20_000;

export interface SearchOptions {
  ownNicks: Record<string, string>;
  limit?: number;
  beforeTime?: number;
  skipAtBeforeTime?: number;
}

export interface SearchCandidate {
  serverId: string;
  target: string;
  time: number;
  nick: string;
  text: string;
  msgid?: string;
  hasLink: boolean;
  isOwn: boolean;
  repliesToOwn: boolean;
}

interface Filter {
  query: SearchQuery;
  terms: QueryTerms;
  from?: string;
  lower: number;
  upper: number;
  ownNicks: Record<string, string>;
}

// An ordered driver yields rows newest first and stops once a page is full;
// an unordered one has to load all of its rows before it can sort them.
interface Driver {
  count: Promise<number>;
  isOrdered: boolean;
  ids: () => AsyncGenerator<number[]>;
}

function filterOf(query: SearchQuery, opts: SearchOptions): Filter {
  return {
    query,
    terms: queryTermsOf(query.text),
    from: query.from?.trim().toLowerCase() || undefined,
    lower: query.after ?? Number.NEGATIVE_INFINITY,
    upper: Math.min(
      query.before ?? Number.POSITIVE_INFINITY,
      opts.beforeTime === undefined
        ? Number.POSITIVE_INFINITY
        : opts.beforeTime + 1,
    ),
    ownNicks: opts.ownNicks,
  };
}

function isInScope(scope: SearchScope, serverId: string, target: string) {
  if (scope.kind === "everywhere") return true;
  if (scope.kind === "network") return serverId === scope.serverId;
  return serverId === scope.serverId && target === scope.target.toLowerCase();
}

function aboutMeOf(
  candidate: SearchCandidate,
  ownNicks: Record<string, string>,
): SearchHit["aboutMe"] {
  if (candidate.isOwn) return undefined;
  if (candidate.repliesToOwn) return "reply";
  const nick = ownNicks[candidate.serverId];
  return nick && mentionsNick(candidate.text, nick) ? "mention" : undefined;
}

function matches(candidate: SearchCandidate, filter: Filter): boolean {
  const { query } = filter;
  return (
    candidate.time > filter.lower &&
    candidate.time < filter.upper &&
    isInScope(query.scope, candidate.serverId, candidate.target) &&
    (!filter.from || candidate.nick.toLowerCase() === filter.from) &&
    (!query.hasLink || candidate.hasLink) &&
    (!query.aboutMe || !!aboutMeOf(candidate, filter.ownNicks)) &&
    matchesTerms(candidate.text, filter.terms)
  );
}

function hitOf(candidate: SearchCandidate, filter: Filter): SearchHit {
  const aboutMe = aboutMeOf(candidate, filter.ownNicks);
  return {
    serverId: candidate.serverId,
    target: candidate.target,
    time: candidate.time,
    nick: candidate.nick,
    text: candidate.text,
    ...(candidate.msgid ? { msgid: candidate.msgid } : {}),
    isAboutMe: !!aboutMe,
    ...(aboutMe ? { aboutMe } : {}),
  };
}

// Messages can share a millisecond, so a page resumes at the last hit's time
// and skips the hits already shown at that time.
function pageOf(
  hits: SearchHit[],
  limit: number,
  opts: SearchOptions,
): SearchPage {
  if (hits.length < limit) return { hits };
  const last = hits[hits.length - 1].time;
  const shownBefore =
    opts.beforeTime === last ? (opts.skipAtBeforeTime ?? 0) : 0;
  return {
    hits,
    nextBeforeTime: last,
    nextSkip: shownBefore + hits.filter((hit) => hit.time === last).length,
  };
}

function skipsShown(opts: SearchOptions) {
  let toSkip = opts.skipAtBeforeTime ?? 0;
  return (time: number) => {
    if (toSkip > 0 && time === opts.beforeTime) {
      toSkip -= 1;
      return true;
    }
    return false;
  };
}

export function searchCandidates(
  candidates: SearchCandidate[],
  query: SearchQuery,
  opts: SearchOptions,
): SearchPage {
  const filter = filterOf(query, opts);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const isShown = skipsShown(opts);
  const hits = candidates
    .filter((candidate) => matches(candidate, filter))
    .sort((a, b) => b.time - a.time)
    .filter((candidate) => !isShown(candidate.time))
    .slice(0, limit)
    .map((candidate) => hitOf(candidate, filter));
  return pageOf(hits, limit, opts);
}

async function candidateOf(
  rows: IDBObjectStore,
  row: HistoryRow,
): Promise<SearchCandidate> {
  const fields = row.text === undefined ? searchFieldsOf(row.raw) : undefined;
  const repliesToOwn = fields?.replyTo
    ? await isOwnMessage(rows, row.server, row.target, fields.replyTo)
    : row.replyToOwn === 1;
  return {
    serverId: row.server,
    target: row.target,
    time: row.time,
    nick: fields?.nick ?? row.nick ?? "",
    text: fields?.text ?? row.text ?? "",
    ...(row.msgid ? { msgid: row.msgid } : {}),
    hasLink: fields?.hasLink ?? !!row.hasLink,
    isOwn: fields?.isOwn ?? !!row.isOwn,
    repliesToOwn,
  };
}

// Walks keys newest first and hands out row ids a chunk at a time, so we
// stop reading as soon as a page is full.
async function* walkKeys(
  source: IDBObjectStore | IDBIndex,
  range: IDBKeyRange,
  rowIdOf: (cursor: IDBCursor) => number,
): AsyncGenerator<number[]> {
  const request = source.openKeyCursor(range, "prev");
  let cursor = null as IDBCursor | null;
  do {
    const ids: number[] = [];
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        cursor = request.result;
        if (!cursor) return resolve();
        ids.push(rowIdOf(cursor));
        if (ids.length >= FETCH_CHUNK) return resolve();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      cursor?.continue();
    });
    if (ids.length) yield ids;
  } while (cursor);
}

interface Posting {
  id: number;
  time: number;
}

async function* inChunks(
  load: () => Promise<Posting[]>,
): AsyncGenerator<number[]> {
  const found = await load();
  const ids = [
    ...new Set(
      found.sort((a, b) => b.time - a.time || b.id - a.id).map((p) => p.id),
    ),
  ];
  for (let start = 0; start < ids.length; start += FETCH_CHUNK)
    yield ids.slice(start, start + FETCH_CHUNK);
}

type TermKey = [string, number, number];

function termKeysIn(
  terms: IDBObjectStore,
  range: IDBKeyRange,
  filter: Filter,
): Promise<Posting[]> {
  return awaitRequest(terms.getAllKeys(range)).then((keys) =>
    (keys as TermKey[])
      .filter(([, time]) => time > filter.lower && time < filter.upper)
      .map(([, time, id]) => ({ id, time })),
  );
}

const termRange = (term: string, filter: Filter) =>
  IDBKeyRange.bound(
    [indexTermOf(term), filter.lower],
    [indexTermOf(term), filter.upper],
  );

// A word's postings either drive a newest-first walk, or, when there are few
// enough of them, load whole so we intersect all words in memory.
interface TextTerm {
  count: Promise<number>;
  load: () => Promise<Posting[]>;
  driver: Driver;
}

function exactTerm(
  terms: IDBObjectStore,
  term: string,
  filter: Filter,
): TextTerm {
  const range = termRange(term, filter);
  const count = awaitRequest(terms.count(range));
  return {
    count,
    load: () => termKeysIn(terms, range, filter),
    driver: {
      count,
      isOrdered: true,
      ids: () =>
        walkKeys(terms, range, (cursor) => (cursor.primaryKey as TermKey)[2]),
    },
  };
}

function prefixTerm(
  terms: IDBObjectStore,
  prefix: string,
  filter: Filter,
): TextTerm {
  const start = indexTermOf(prefix);
  const range = IDBKeyRange.bound([start], [`${start}${LAST_CHAR}`]);
  const load = () => termKeysIn(terms, range, filter);
  const count = awaitRequest(terms.count(range));
  return {
    count,
    load,
    driver: { count, isOrdered: false, ids: () => inChunks(load) },
  };
}

function indexDriver(index: IDBIndex, range: IDBKeyRange): Driver {
  return {
    count: awaitRequest(index.count(range)),
    isOrdered: true,
    ids: () => walkKeys(index, range, (cursor) => cursor.primaryKey as number),
  };
}

function scopeDriver(rows: IDBObjectStore, filter: Filter): Driver {
  const { scope } = filter.query;
  const { lower, upper } = filter;
  if (scope.kind === "chat") {
    const target = scope.target.toLowerCase();
    return indexDriver(
      rows.index("conv"),
      IDBKeyRange.bound(
        [scope.serverId, target, lower],
        [scope.serverId, target, upper],
      ),
    );
  }
  if (scope.kind === "network")
    return indexDriver(
      rows.index("serverTime"),
      IDBKeyRange.bound([scope.serverId, lower], [scope.serverId, upper]),
    );
  return indexDriver(rows.index("time"), IDBKeyRange.bound(lower, upper));
}

// Replies to us come from their own index and mentions from the postings of
// our nick's longest word. A nick without an indexed word cannot drive.
function aboutMeDriver(
  rows: IDBObjectStore,
  terms: IDBObjectStore,
  filter: Filter,
): Driver | undefined {
  const { scope } = filter.query;
  const nicks =
    scope.kind === "everywhere"
      ? Object.values(filter.ownNicks)
      : [filter.ownNicks[scope.serverId]].filter(Boolean);
  const nickTerms = nicks.map(
    (nick) => termsOf(nick).sort((a, b) => b.length - a.length)[0],
  );
  if (nickTerms.some((term) => term === undefined)) return;
  const words = [...new Set(nickTerms)];
  const replies = IDBKeyRange.bound([1, filter.lower], [1, filter.upper]);
  const replyIndex = rows.index("replyToOwn");
  return {
    count: Promise.all([
      awaitRequest(replyIndex.count(replies)),
      ...words.map((word) =>
        awaitRequest(terms.count(termRange(word, filter))),
      ),
    ]).then((counts) => counts.reduce((sum, count) => sum + count, 0)),
    isOrdered: false,
    ids: () =>
      inChunks(async () => {
        const found = await Promise.all([
          awaitRequest<HistoryRow[]>(replyIndex.getAll(replies)).then((list) =>
            list.map((row) => ({ id: row.id, time: row.time })),
          ),
          ...words.map((word) =>
            termKeysIn(terms, termRange(word, filter), filter),
          ),
        ]);
        return found.flat();
      }),
  };
}

function otherDrivers(
  rows: IDBObjectStore,
  terms: IDBObjectStore,
  filter: Filter,
): Driver[] {
  const drivers: Driver[] = [];
  if (filter.from)
    drivers.push(
      indexDriver(
        rows.index("nick"),
        IDBKeyRange.bound(
          [filter.from, filter.lower],
          [filter.from, filter.upper],
        ),
      ),
    );
  if (filter.query.aboutMe) {
    const driver = aboutMeDriver(rows, terms, filter);
    if (driver) drivers.push(driver);
  }
  return drivers;
}

// Counting a scope reads its whole index, and an ordered source already stops
// after one page, so we only weigh the scope when every other source is
// unordered.
function withScope(
  drivers: Driver[],
  rows: IDBObjectStore,
  filter: Filter,
): Driver[] {
  return drivers.some((driver) => driver.isOrdered)
    ? drivers
    : [...drivers, scopeDriver(rows, filter)];
}

const listDriver = (postings: Posting[]): Driver => ({
  count: Promise.resolve(postings.length),
  isOrdered: true,
  ids: () => inChunks(async () => postings),
});

// Words with few postings are intersected in memory and the rest are checked
// on the rows. Then we walk whichever source names the fewest rows: those
// intersected postings, the rarest word, the sender, the replies and
// mentions, or the scope itself. Every row is checked against all filters.
async function planSearch(
  rows: IDBObjectStore,
  terms: IDBObjectStore,
  filter: Filter,
  limit: number,
): Promise<{ driver: Driver; keep: (id: number) => boolean }> {
  const text = [
    ...filter.terms.exact.map((term) => exactTerm(terms, term, filter)),
    ...(filter.terms.prefix
      ? [prefixTerm(terms, filter.terms.prefix, filter)]
      : []),
  ];
  const others = otherDrivers(rows, terms, filter);
  const counts = await Promise.all(text.map((term) => term.count));
  const few = text.filter((_, index) => counts[index] <= INTERSECT_CAP);
  if (few.length === 0) {
    const drivers = withScope(
      [...text.map((term) => term.driver), ...others],
      rows,
      filter,
    );
    return { driver: await cheapest(drivers, limit), keep: () => true };
  }
  const lists = await Promise.all(few.map((term) => term.load()));
  const sets = lists.map((list) => new Set(list.map((posting) => posting.id)));
  const keep = (id: number) => sets.every((set) => set.has(id));
  const shortest = lists.reduce((a, b) => (b.length < a.length ? b : a));
  const drivers = withScope(
    [listDriver(shortest.filter((posting) => keep(posting.id))), ...others],
    rows,
    filter,
  );
  return { driver: await cheapest(drivers, limit), keep };
}

// An ordered walk stops after about limit / selectivity rows, and the
// smallest source bounds how many rows can match at all.
async function cheapest(drivers: Driver[], limit: number): Promise<Driver> {
  const counts = await Promise.all(drivers.map((driver) => driver.count));
  const matchBound = Math.max(1, Math.min(...counts));
  const costs = drivers.map((driver, index) =>
    driver.isOrdered
      ? Math.min(counts[index], (counts[index] * limit) / matchBound)
      : counts[index],
  );
  return drivers[costs.indexOf(Math.min(...costs))];
}

export function searchMessages(
  query: SearchQuery,
  opts: SearchOptions,
): Promise<SearchPage> {
  const filter = filterOf(query, opts);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (filter.lower >= filter.upper || limit <= 0)
    return Promise.resolve({ hits: [] });
  // Rows the backfill has not reached yet have no words, sender or reply
  // flag indexed, so until it finishes we walk the scope and check each row.
  return readSearchIndex<SearchPage>(
    { hits: [] },
    async (rows, terms, isIndexing) => {
      const { driver, keep } = isIndexing
        ? { driver: scopeDriver(rows, filter), keep: () => true }
        : await planSearch(rows, terms, filter, limit);
      const hits: SearchHit[] = [];
      const isShown = skipsShown(opts);
      for await (const ids of driver.ids()) {
        const found = await Promise.all(
          ids
            .filter(keep)
            .map((id) => awaitRequest<HistoryRow | undefined>(rows.get(id))),
        );
        for (const row of found) {
          if (!row || row.ref !== undefined) continue;
          const candidate = await candidateOf(rows, row);
          if (!matches(candidate, filter) || isShown(candidate.time)) continue;
          hits.push({ ...hitOf(candidate, filter), nick: senderOf(row.raw) });
          if (hits.length === limit) return pageOf(hits, limit, opts);
        }
      }
      return pageOf(hits, limit, opts);
    },
  );
}
