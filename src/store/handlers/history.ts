import type { StoreApi } from "zustand";
import { e2eeSessionKey, isEncryptionEngaged } from "../../lib/e2ee/session";
import {
  addGap,
  adoptParkedHistory,
  appendRows,
  deleteGap,
  deleteMessage,
  deleteMessagesMissingFromPage,
  deleteServerHistory,
  eventRowsAfter,
  eventRowsBefore,
  fillableGaps,
  gapsFor,
  type HistoryGap,
  type HistoryRow,
  hasServerHistory,
  type NewHistoryRow,
  newestEventRows,
  parkServerHistory,
  pruneToLimit,
  refRowsFor,
  savedSenders,
  updateGap,
} from "../../lib/history/historyDb";
import {
  buildReplayLines,
  decideAfterForwardFill,
  decideAfterGapFill,
  decideAfterLatest,
  HISTORY_GAP_CODE,
  HISTORY_PAGE_SIZE,
  type HistoryAction,
  type HistoryPage,
  HistoryRecorder,
  LOCAL_BATCH_PREFIX,
  LOCAL_HISTORY_TAG,
  planLoadMore,
} from "../../lib/history/historyLines";
import {
  isInScope,
  type SearchCandidate,
  type SearchOptions,
  searchCandidates,
  searchMessages,
} from "../../lib/history/historySearch";
import { containsLink, plainText } from "../../lib/history/searchFields";
import ircClient from "../../lib/ircClient";
import { parseMessageTags } from "../../lib/ircUtils";
import type {
  SearchPage,
  SearchQuery,
  SearchScope,
} from "../../lib/search/searchTypes";
import type { Message, Server } from "../../types";
import {
  MAX_MESSAGES_PER_CHANNEL,
  messageTime,
  normalizeHost,
  serverSupportsChathistory,
} from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";

export const BYTES_PER_MB = 1_000_000;
const PRUNE_EVERY_WRITES = 200;
const MAX_AUTO_FILL_PAGES = 10;
// Servers throttle CHATHISTORY (obbyircd allows about one command a second
// after a short burst), so we keep one page in flight, pace the rest and stop
// after a bounded amount of history.
const SEARCH_FILL_MAX_PAGES = 40;
const SEARCH_FILL_PACE_MS = 1000;
const SEARCH_FILL_TIMEOUT_MS = 20_000;

type GapFill = {
  gap?: HistoryGap;
  pagesLeft?: number;
  isDiskOnly?: boolean;
  onSettled?: (isSaved: boolean, page?: HistoryPage) => void;
};

type PendingRequest =
  | { kind: "latest"; newestStoredTime: Promise<number | undefined> }
  | { kind: "before" | "after" | "around"; fill?: GapFill };

const recorders = new Map<string, HistoryRecorder>();
const pendingRequests = new Map<string, PendingRequest[]>();
// The gap a BEFORE request is about to fill. We attach it when the line
// actually leaves, so a request the socket dropped never claims a reply.
let nextGapFill: GapFill | undefined;

// Two requests for the same gap ask for the same page, and the second reply,
// all duplicates, would close the gap, so we keep one request per gap.
function isGapBeingFilled(serverId: string, target: string, gapId: number) {
  return (pendingRequests.get(conversationKey(serverId, target)) ?? []).some(
    (request) => request.kind !== "latest" && request.fill?.gap?.id === gapId,
  );
}

export function isServerPageComing(serverId: string, target: string): boolean {
  return (pendingRequests.get(conversationKey(serverId, target)) ?? []).some(
    (request) => request.kind === "latest" || !request.fill?.isDiskOnly,
  );
}

function requestPageBefore(
  serverId: string,
  target: string,
  before: number,
  fill: GapFill | undefined,
  showLoading = true,
): boolean {
  if (fill?.gap && isGapBeingFilled(serverId, target, fill.gap.id))
    return false;
  nextGapFill = fill;
  const isSent = ircClient.requestChathistoryBefore(
    serverId,
    target,
    new Date(before).toISOString(),
    { showLoading },
  );
  nextGapFill = undefined;
  return isSent;
}

const shownConversations = new Set<string>();
let writesSincePrune = 0;
let replayCounter = 0;
let registeredStore: StoreApi<AppState> | undefined;

// Removed and re-added servers find their parked history by this address.
// Bouncer networks share the bouncer's host and port, so theirs adds the netid.
function serverAddress(
  server: Pick<Server, "host" | "port" | "bouncerNetid">,
): string {
  const address = `${normalizeHost(server.host).toLowerCase()}:${server.port}`;
  return server.bouncerNetid ? `${address}/${server.bouncerNetid}` : address;
}

// We add the login to the address, so two accounts on one network never take each other's history.
function serverLoginAddress(
  server: Pick<
    Server,
    "id" | "host" | "port" | "bouncerNetid" | "bouncerServerId"
  >,
): string {
  const configId = server.bouncerServerId ?? server.id;
  const config = storage.servers.load().find((c) => c.id === configId);
  const login = (
    config?.saslAccountName ||
    config?.nickname ||
    ""
  ).toLowerCase();
  return `${serverAddress(server)}#${login}`;
}

// We fall back to the bare address for history parked before logins were part of it.
async function adoptHistoryForServer(server: Server): Promise<void> {
  if (await adoptParkedHistory(serverLoginAddress(server), server.id)) return;
  await adoptParkedHistory(serverAddress(server), server.id);
}

function loadedCandidates(
  state: AppState,
  ownNicks: Record<string, string>,
): SearchCandidate[] {
  return state.servers.flatMap((server) => {
    const own = ownNicks[server.id]?.toLowerCase();
    const chats = [
      ...server.channels.map((c) => ({ id: c.id, target: c.name })),
      ...(server.privateChats ?? []).map((pc) => ({
        id: pc.id,
        target: pc.username,
      })),
    ];
    return chats.flatMap(({ id, target }) =>
      (state.messages[`${server.id}-${id}`] ?? [])
        .filter((m) => m.type === "message" || m.type === "notice")
        .map((m) => {
          const text = plainText(m.content);
          return {
            serverId: server.id,
            target: target.toLowerCase(),
            time: new Date(m.timestamp).getTime(),
            nick: m.userId,
            text,
            ...(m.msgid ? { msgid: m.msgid } : {}),
            hasLink: containsLink(text),
            isOwn: m.userId.toLowerCase() === own,
            repliesToOwn: !!own && m.replyMessage?.userId.toLowerCase() === own,
          };
        }),
    );
  });
}

// With history off we search the messages loaded in this session.
export function searchSavedMessages(
  store: StoreApi<AppState>,
  query: SearchQuery,
  opts: Omit<SearchOptions, "ownNicks"> = {},
): Promise<SearchPage> {
  const state = store.getState();
  const ownNicks: Record<string, string> = {};
  for (const server of state.servers) {
    const nick = ircClient.getNick(server.id);
    if (nick) ownNicks[server.id] = nick;
  }
  return isEnabled(store)
    ? searchMessages(query, { ...opts, ownNicks })
    : Promise.resolve(
        searchCandidates(loadedCandidates(state, ownNicks), query, {
          ...opts,
          ownNicks,
        }),
      );
}

export function listSavedSenders(
  store: StoreApi<AppState> | undefined = registeredStore,
): Promise<string[]> {
  if (!store || isEnabled(store)) return savedSenders();
  const nicks = loadedCandidates(store.getState(), {}).map((candidate) =>
    candidate.nick.toLowerCase(),
  );
  return Promise.resolve([...new Set(nicks)].filter(Boolean).sort());
}

export async function hasSavedChat(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): Promise<boolean> {
  if (!isEnabled(store)) return false;
  return (await newestEventRows(serverId, target.toLowerCase(), 1)).length > 0;
}

export function hasSavedHistory(serverId: string): Promise<boolean> {
  return hasServerHistory(serverId);
}

export function settleSavedHistory(
  server: Server,
  shouldDelete: boolean,
): Promise<void> {
  return shouldDelete
    ? deleteServerHistory(server.id)
    : parkServerHistory(server.id, serverLoginAddress(server));
}

const conversationKey = (serverId: string, target: string) =>
  `${serverId}\n${target.toLowerCase()}`;

function recorderFor(
  store: StoreApi<AppState>,
  serverId: string,
): HistoryRecorder {
  let recorder = recorders.get(serverId);
  if (!recorder) {
    const isKnown = store.getState().servers.some((s) => s.id === serverId);
    recorder = new HistoryRecorder(serverId, {
      ownNick: () => ircClient.getNick(serverId),
      hasChathistory: () =>
        serverSupportsChathistory(store.getState(), serverId),
      chantypes: () => ircClient.chantypes(serverId),
      isOpenConversation: (target) =>
        findConversation(store, serverId, target) !== undefined,
      isEncryptedPm: (nick) =>
        isEncryptionEngaged(
          store.getState().e2eeSessions[e2eeSessionKey(serverId, nick)],
        ),
      now: () => Date.now(),
    });
    if (isKnown) recorders.set(serverId, recorder);
  }
  return recorder;
}

function isEnabled(store: StoreApi<AppState>): boolean {
  return store.getState().globalSettings.keepHistory !== false;
}

async function saveRows(store: StoreApi<AppState>, rows: NewHistoryRow[]) {
  const inserted = await appendRows(rows);
  writesSincePrune += rows.length;
  if (writesSincePrune >= PRUNE_EVERY_WRITES) {
    writesSincePrune = 0;
    await pruneToLimit(
      store.getState().globalSettings.historyLimitMb * BYTES_PER_MB,
    );
  }
  return inserted;
}

// A page fetched around a time can land apart from the rows we had, or inside
// a gap, so we replace the gaps it overlaps with one on each side whose edge
// row is new to us.
async function addIslandGaps(
  server: string,
  target: string,
  page: HistoryPage,
  inserted: boolean[],
) {
  if (page.oldest === undefined || page.newest === undefined) return;
  for (const gap of await gapsFor(server, target))
    if (gap.from < page.newest && gap.to > page.oldest) await deleteGap(gap.id);
  const [older] = await eventRowsBefore(server, target, page.oldest - 1, 1);
  if (older && inserted[0])
    await addGap({
      server,
      target,
      from: older.time,
      to: page.oldest,
      lost: false,
    });
  const [newer] = await eventRowsAfter(server, target, page.newest + 1, 1);
  if (newer && inserted[inserted.length - 1])
    await addGap({
      server,
      target,
      from: page.newest,
      to: newer.time,
      lost: false,
    });
}

async function saveHistoryPage(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  rows: NewHistoryRow[],
  redacts: string[],
  page: HistoryPage,
) {
  const key = serverId;
  const request = pendingRequests
    .get(conversationKey(serverId, target))
    ?.shift();
  const inserted = rows.length ? await saveRows(store, rows) : [];
  for (const msgid of redacts) await deleteMessage(key, target, msgid);
  if (page.oldest !== undefined && page.newest !== undefined)
    await deleteMessagesMissingFromPage(
      key,
      target,
      page.oldest,
      page.newest,
      page.msgids,
    );
  if (request?.kind === "latest") {
    const decision = decideAfterLatest({
      newestStoredTime: await request.newestStoredTime,
      page,
    });
    if (decision.kind === "add") {
      const { from, to } = decision;
      await addGap({ server: key, target, from, to, lost: false });
      const [gap] = (await gapsFor(key, target)).filter(
        (g) => g.from === from && g.to === to,
      );
      if (gap) settleGap(store, serverId, target, gap, MAX_AUTO_FILL_PAGES);
    }
  } else if (request?.kind === "around") {
    await addIslandGaps(key, target, page, inserted);
    request.fill?.onSettled?.(true);
  } else if (request?.kind === "after" && request.fill) {
    const filled = (await gapsFor(key, target)).find(
      (gap) => gap.id === request.fill?.gap?.id,
    );
    const decision =
      filled && decideAfterForwardFill({ gap: filled, page, inserted });
    if (filled && decision?.kind === "close") await deleteGap(filled.id);
    else if (filled && decision?.kind === "shrink")
      await updateGap({ ...filled, from: decision.from });
    request.fill.onSettled?.(true);
  } else if (request?.kind === "before" && request.fill) {
    const { pagesLeft } = request.fill;
    // We decide on the gap as saved now, since another fill may have moved it.
    const filled = (await gapsFor(key, target)).find(
      (gap) => gap.id === request.fill?.gap?.id,
    );
    const decision =
      filled && decideAfterGapFill({ gap: filled, page, inserted });
    if (filled && decision?.kind === "close") {
      await deleteGap(filled.id);
    } else if (filled && decision?.kind === "shrink") {
      const gap = { ...filled, to: decision.to, lost: decision.lost };
      await updateGap(gap);
      if (pagesLeft !== undefined)
        settleGap(store, serverId, target, gap, pagesLeft);
    }
    request.fill.onSettled?.(true, page);
  }
  await refreshHasMore(store, serverId, target, page.size > 0);
}

// We decide load more for a chat from both sources: the server may have an
// older page, or our disk has rows older than the oldest message on screen.
async function refreshHasMore(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  serverMayHaveMore: boolean,
) {
  const conversation = findConversation(store, serverId, target);
  if (!conversation) return;
  const hasMore =
    serverMayHaveMore ||
    (await olderDiskRows(store, serverId, target, 1)).length > 0;
  store.setState((state) => ({
    servers: state.servers.map((server) =>
      server.id !== serverId
        ? server
        : {
            ...server,
            channels: server.channels.map((c) =>
              c.id === conversation.channelId
                ? { ...c, hasMoreHistory: hasMore }
                : c,
            ),
            privateChats: server.privateChats?.map((pc) =>
              pc.id === conversation.channelId
                ? { ...pc, hasMoreHistory: hasMore }
                : pc,
            ),
          },
    ),
  }));
}

async function gapsServerCanFill(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): Promise<HistoryGap[]> {
  if (!serverSupportsChathistory(store.getState(), serverId)) return [];
  return (await gapsFor(serverId, target.toLowerCase())).filter(
    (gap) => !gap.lost,
  );
}

// We read saved rows only down to the nearest gap the server can still fill,
// so the messages on screen never run across a hole without a way to fill it.
async function rowsAboveGap(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  time: number,
  rows: HistoryRow[],
): Promise<HistoryRow[]> {
  const [gap] = (await gapsServerCanFill(store, serverId, target))
    .filter((g) => g.to <= time)
    .sort((a, b) => b.to - a.to);
  return gap ? rows.filter((row) => row.time >= gap.to) : rows;
}

type OlderEdge = {
  time: number;
  readCount: number;
  isRead: (row: HistoryRow) => boolean;
};

// A replayed page can hold only hidden rows (from ignored users), which leaves
// the oldest message on screen as it was, so we remember how far back we read.
const readBackTo = new Map<
  string,
  { oldestShownId: string | undefined; time: number; rowIds: Set<number> }
>();

function readBackEdge(
  store: StoreApi<AppState>,
  key: string,
): OlderEdge | undefined {
  const readBack = readBackTo.get(key);
  if (readBack?.oldestShownId !== store.getState().messages[key]?.[0]?.id)
    return undefined;
  return (
    readBack && {
      time: readBack.time,
      readCount: readBack.rowIds.size,
      isRead: (row) => readBack.rowIds.has(row.id),
    }
  );
}

// Where the next older page starts. Messages can share a millisecond, so we
// read past the rows already read there and skip them.
function olderEdge(
  store: StoreApi<AppState>,
  key: string,
): OlderEdge | undefined {
  const readBack = readBackEdge(store, key);
  if (readBack) return readBack;
  const messages = store.getState().messages[key] ?? [];
  if (messages.length === 0) return undefined;
  const oldest = messageTime(messages[0]);
  const sameMs = messages.filter((m) => messageTime(m) === oldest);
  const shown = new Set(
    sameMs.flatMap((m) => [m.msgid, ...(m.multilineMessageIds ?? [])]),
  );
  return {
    time: oldest,
    readCount: sameMs.length,
    isRead: (row) => !!row.msgid && shown.has(row.msgid),
  };
}

function rememberReadBack(
  store: StoreApi<AppState>,
  key: string,
  rows: HistoryRow[],
) {
  const time = rows[0].time;
  const previous = readBackTo.get(key);
  const rowIds = new Set(
    rows.filter((row) => row.time === time).map((row) => row.id),
  );
  if (previous?.time === time) for (const id of previous.rowIds) rowIds.add(id);
  readBackTo.set(key, {
    oldestShownId: store.getState().messages[key]?.[0]?.id,
    time,
    rowIds,
  });
}

// Rows on disk older than the oldest message on screen.
async function olderDiskRows(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  limit: number,
): Promise<HistoryRow[]> {
  const conversation = findConversation(store, serverId, target);
  const edge = conversation && olderEdge(store, conversation.key);
  if (!edge)
    return rowsAboveGap(
      store,
      serverId,
      target,
      Number.POSITIVE_INFINITY,
      await newestEventRows(serverId, target.toLowerCase(), limit),
    );
  const rows = await eventRowsBefore(
    serverId,
    target.toLowerCase(),
    edge.time,
    limit + edge.readCount,
  );
  return rowsAboveGap(
    store,
    serverId,
    target,
    edge.time,
    rows.filter((row) => !edge.isRead(row)).slice(-limit),
  );
}

// A gap inside the messages on screen is invisible, so we fill it from the
// server at once and mark what the server no longer has. A gap above them
// waits for load more.
function settleGap(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  gap: HistoryGap,
  pagesLeft: number,
) {
  const conversation = findConversation(store, serverId, target);
  if (!conversation) return;
  const isOnScreen = (store.getState().messages[conversation.key] ?? []).some(
    (message) => new Date(message.timestamp).getTime() <= gap.from,
  );
  if (!isOnScreen) return;
  if (gap.lost) {
    showMissingMarker(store, serverId, conversation.channelId, gap);
    return;
  }
  if (pagesLeft === 0) return;
  requestPageBefore(
    serverId,
    target,
    gap.to,
    { gap, pagesLeft: pagesLeft - 1 },
    false,
  );
}

export function findConversation(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
) {
  const server = store.getState().servers.find((s) => s.id === serverId);
  const lower = target.toLowerCase();
  const id =
    server?.channels.find((c) => c.name.toLowerCase() === lower)?.id ??
    server?.privateChats?.find((pc) => pc.username.toLowerCase() === lower)?.id;
  return id ? { channelId: id, key: `${serverId}-${id}` } : undefined;
}

function showMissingMarker(
  store: StoreApi<AppState>,
  serverId: string,
  channelId: string,
  gap: HistoryGap,
) {
  store.getState().addMessage({
    id: `history-gap-${gap.id ?? gap.from}`,
    type: "system",
    content: "",
    tags: { [LOCAL_HISTORY_TAG]: HISTORY_GAP_CODE },
    timestamp: new Date(gap.from + 1),
    userId: "",
    channelId,
    serverId,
    reactions: [],
    replyMessage: null,
    mentioned: [],
  });
}

function persistHistoryAction(
  store: StoreApi<AppState>,
  serverId: string,
  action: HistoryAction,
) {
  switch (action.type) {
    case "rows":
      return saveRows(store, action.rows);
    case "redact":
      return deleteMessage(serverId, action.target, action.msgid);
    case "history-batch":
      return saveHistoryPage(
        store,
        serverId,
        action.target,
        action.rows,
        action.redacts,
        action.page,
      );
  }
}

function trackOutgoing(
  store: StoreApi<AppState>,
  serverId: string,
  line: string,
) {
  const request = /^CHATHISTORY (LATEST|BEFORE|AFTER|AROUND) (\S+)/.exec(line);
  if (request) {
    const target = request[2].toLowerCase();
    const queue = pendingRequests.get(conversationKey(serverId, target)) ?? [];
    const kind = request[1].toLowerCase() as "before" | "after" | "around";
    queue.push(
      request[1] === "LATEST"
        ? {
            kind: "latest",
            newestStoredTime: newestEventRows(serverId, target, 1).then(
              ([row]) => row?.time,
            ),
          }
        : { kind, fill: nextGapFill },
    );
    pendingRequests.set(conversationKey(serverId, target), queue);
    return;
  }
  // Without echo-message the server never sends our own lines back, so we
  // record what we sent as if it had.
  const sent = /^(?:(@\S+) )?(PRIVMSG (\S+) :(.*))$/.exec(line);
  if (sent && !ircClient.hasCapability(serverId, "echo-message")) {
    const nick = ircClient.getNick(serverId);
    if (!nick) return;
    const [, tags, rest, target, text] = sent;
    const source = `${nick}!${nick}@local`;
    for (const action of recorderFor(store, serverId).feed({
      line: `${tags ? `${tags} ` : ""}:${source} ${rest}`,
      command: "PRIVMSG",
      source,
      parv: [target, text],
      mtags: tags ? parseMessageTags(tags) : undefined,
    }))
      void persistHistoryAction(store, serverId, action);
  }
}

export function registerHistoryHandlers(store: StoreApi<AppState>): void {
  registeredStore = store;
  ircClient.on("parsedLine", ({ serverId, ...parsed }) => {
    if (!isEnabled(store)) return;
    for (const action of recorderFor(store, serverId).feed(parsed))
      void persistHistoryAction(store, serverId, action);
  });

  store.subscribe(() => {
    const update = moveArrivalsToPresent(store.getState());
    if (update) store.setState(update);
  });

  ircClient.on("rawLine", ({ serverId, direction, line }) => {
    if (direction !== "tx") return;
    const said = /^(?:@\S+ )?PRIVMSG (\S+) :/.exec(line);
    if (said) showPresent(store, serverId, said[1]);
    if (isEnabled(store)) trackOutgoing(store, serverId, line);
  });

  ircClient.on("BATCH_START", ({ serverId, batchId, type, parameters }) => {
    const target = parameters?.[0];
    if (type !== "chathistory" || !target) return;
    if (batchId.startsWith(LOCAL_BATCH_PREFIX)) return;
    const [request] =
      pendingRequests.get(conversationKey(serverId, target)) ?? [];
    if (request && request.kind !== "latest" && request.fill?.isDiskOnly)
      ircClient.markDiskOnlyBatch(serverId, batchId);
  });

  // A refused CHATHISTORY opens no batch, so we drop its request here or the
  // next reply would be matched to it.
  ircClient.on("FAIL", ({ serverId, command, context }) => {
    if (command !== "CHATHISTORY") return;
    const target = context.find(
      (part) => pendingRequests.get(conversationKey(serverId, part))?.length,
    );
    if (!target) return;
    const request = pendingRequests
      .get(conversationKey(serverId, target))
      ?.shift();
    if (request && request.kind !== "latest") request.fill?.onSettled?.(false);
  });

  ircClient.on("connectionStateChange", ({ serverId, connectionState }) => {
    if (connectionState === "connected") {
      const server =
        store.getState().servers.find((s) => s.id === serverId) ??
        ircClient.servers.get(serverId);
      if (server) void adoptHistoryForServer(server);
      return;
    }
    ircClient.clearDiskOnlyBatches(serverId);
    for (const [key, queue] of pendingRequests) {
      if (!key.startsWith(`${serverId}\n`)) continue;
      for (const request of queue)
        if (request.kind !== "latest") request.fill?.onSettled?.(false);
      pendingRequests.delete(key);
    }
  });
}

async function searchableGaps(
  store: StoreApi<AppState>,
  scope: SearchScope,
): Promise<HistoryGap[]> {
  const state = store.getState();
  return (await fillableGaps())
    .filter(
      (gap) =>
        isInScope(scope, gap.server, gap.target.toLowerCase()) &&
        state.servers.some((s) => s.id === gap.server && s.isConnected) &&
        serverSupportsChathistory(state, gap.server) &&
        findConversation(store, gap.server, gap.target) !== undefined,
    )
    .sort((a, b) => b.to - a.to);
}

// We stop waiting at the timeout but keep the request queued, so a late reply
// still goes to disk and fills its gap.
function fetchGapPage(gap: HistoryGap): Promise<boolean> {
  return new Promise((resolve) => {
    const fill: GapFill = { gap, isDiskOnly: true };
    const timer = window.setTimeout(
      () => resolve(false),
      SEARCH_FILL_TIMEOUT_MS,
    );
    fill.onSettled = (isSaved) => {
      window.clearTimeout(timer);
      resolve(isSaved);
    };
    if (!requestPageBefore(gap.server, gap.target, gap.to, fill, false))
      fill.onSettled(false);
  });
}

function fetchPageToDisk(
  serverId: string,
  target: string,
  subcommand: "AFTER" | "AROUND",
  time: number,
  gap?: HistoryGap,
): Promise<boolean> {
  return new Promise((resolve) => {
    const fill: GapFill = { gap, isDiskOnly: true };
    const timer = window.setTimeout(
      () => resolve(false),
      SEARCH_FILL_TIMEOUT_MS,
    );
    fill.onSettled = (isSaved) => {
      window.clearTimeout(timer);
      resolve(isSaved);
    };
    nextGapFill = fill;
    const isSent = ircClient.requestChathistoryAt(
      serverId,
      target,
      subcommand,
      new Date(time).toISOString(),
    );
    nextGapFill = undefined;
    if (!isSent) fill.onSettled(false);
  });
}

// A chat opens on its read marker: from the rows we saved when they cover it,
// otherwise from a page the server sends around it. A marker older than what
// the server keeps opens on the oldest message it still has after it.
export async function showMessagesFromReadMarker(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  marker: number,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isEnabled(store)) return false;
  const lower = target.toLowerCase();
  const [lastRead] = await eventRowsBefore(serverId, lower, marker + 1, 1);
  const isMarkerInGap = (await gapsFor(serverId, lower)).some(
    (gap) => gap.from < marker && marker < gap.to,
  );
  const isSaved = lastRead?.time === marker && !isMarkerInGap;
  if (!isSaved && serverSupportsChathistory(store.getState(), serverId))
    await fetchPageToDisk(serverId, target, "AROUND", marker);
  const [firstUnread] = await eventRowsAfter(serverId, lower, marker, 1);
  if (!firstUnread) return false;
  const shown = await showSavedMessagesAround(
    store,
    serverId,
    target,
    firstUnread.time,
    isCurrent,
  );
  if (shown !== "loaded" || !isCurrent()) return false;
  // The last read message is gone from both the server and this device, so
  // we say messages before the first unread one may be missing.
  const [stillSaved] = await eventRowsBefore(serverId, lower, marker + 1, 1);
  const conversation = findConversation(store, serverId, target);
  if (stillSaved?.time !== marker && conversation)
    showMissingMarker(store, serverId, conversation.channelId, {
      id: -firstUnread.time,
      server: serverId,
      target: lower,
      from: firstUnread.time - 2,
      to: firstUnread.time,
      lost: true,
    });
  return true;
}

// While a search pane is open we fetch what the server still has for the gaps
// in its scope, newest gap first, and report the gaps left after every page
// so the results can refresh.
export function fillGapsForSearch(
  store: StoreApi<AppState>,
  scope: SearchScope,
  onProgress: (
    gaps: HistoryGap[],
    isFetching: boolean,
    pagesFetched: number,
  ) => void,
): () => void {
  let isCancelled = false;
  let pagesFetched = 0;
  const report = (gaps: HistoryGap[], isFetching: boolean) => {
    if (!isCancelled) onProgress(gaps, isFetching, pagesFetched);
  };
  void (async () => {
    if (!isEnabled(store)) return report([], false);
    while (pagesFetched < SEARCH_FILL_MAX_PAGES) {
      const gaps = await searchableGaps(store, scope);
      if (gaps.length === 0 || isCancelled) return report(gaps, false);
      report(gaps, true);
      if (pagesFetched > 0)
        await new Promise((r) => setTimeout(r, SEARCH_FILL_PACE_MS));
      if (isCancelled) return;
      if (!(await fetchGapPage(gaps[0]))) break;
      pagesFetched += 1;
    }
    report(await searchableGaps(store, scope), false);
  })();
  return () => {
    isCancelled = true;
  };
}

// Our disk is the only source on a server without history, and for private
// chats on servers that keep channel history only, so we show its newest page
// the first time such a chat is opened in this session.
export function showSavedHistory(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): void {
  const key = conversationKey(serverId, target);
  if (
    !isEnabled(store) ||
    (ircClient.isChannel(serverId, target) &&
      serverSupportsChathistory(store.getState(), serverId))
  )
    return;
  if (shownConversations.has(key)) return;
  shownConversations.add(key);
  void replayNewestPage(store, serverId, target);
}

function setLoading(serverId: string, target: string, isLoading: boolean) {
  ircClient.triggerEvent("CHATHISTORY_LOADING", {
    serverId,
    channelName: target,
    isLoading,
  });
}

async function replayRows(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  rows: HistoryRow[],
  beforeReplay: () => boolean = () => true,
) {
  const msgids = rows.flatMap((row) => (row.msgid ? [row.msgid] : []));
  const reactions = msgids.length ? await refRowsFor(serverId, msgids) : [];
  if (!beforeReplay()) return;
  const ordered = [...rows, ...reactions].sort((a, b) => a.time - b.time);
  replayCounter += 1;
  const nick = ircClient.getNick(serverId);
  ircClient.replayLines(
    serverId,
    buildReplayLines(
      target,
      ordered,
      `${LOCAL_BATCH_PREFIX}${replayCounter}`,
      nick ? `${nick}!${nick}@local` : undefined,
    ),
  );
  if (rows.length) {
    const oldest = rows[0].time;
    const newest = rows[rows.length - 1].time;
    await showLostGaps(
      store,
      serverId,
      target,
      (gap) => gap.from >= oldest && gap.from <= newest,
    );
  }
  await refreshHasMore(
    store,
    serverId,
    target,
    serverSupportsChathistory(store.getState(), serverId),
  );
}

async function showLostGaps(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  isShown: (gap: HistoryGap) => boolean,
) {
  const conversation = findConversation(store, serverId, target);
  if (!conversation) return;
  for (const gap of await gapsFor(serverId, target.toLowerCase()))
    if (gap.lost && isShown(gap))
      showMissingMarker(store, serverId, conversation.channelId, gap);
}

async function replayOlderDiskPage(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): Promise<number> {
  const conversation = findConversation(store, serverId, target);
  const rows = await olderDiskRows(store, serverId, target, HISTORY_PAGE_SIZE);
  if (!conversation || rows.length === 0) return 0;
  const oldestShown = () =>
    store.getState().messages[conversation.key]?.[0]?.id;
  const wasOldest = oldestShown();
  await replayRows(store, serverId, target, rows);
  rememberReadBack(store, conversation.key, rows);
  // Nothing on the page showed, so we keep reading back until something does
  // or the history ends.
  if (oldestShown() === wasOldest)
    await loadOlderMessages(store, serverId, target, rows[0].time);
  return rows.length;
}

async function replayNewestPage(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
) {
  const rows = await newestEventRows(
    serverId,
    target.toLowerCase(),
    HISTORY_PAGE_SIZE,
  );
  if (rows.length) await replayRows(store, serverId, target, rows);
}

// A channel's older page goes to disk first and the list reads it back from
// there, so scrolling shows history through one path. Private chats skip
// this: we never save encrypted or services messages, which would vanish.
function diskFirstFill(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  oldestTime: number,
  gap: HistoryGap | undefined,
): GapFill {
  return {
    gap,
    isDiskOnly: true,
    onSettled: (isSaved, page) => {
      void (async () => {
        if (isSaved && (await replayOlderDiskPage(store, serverId, target)))
          return;
        // A page of lines we never show, like typing notices, can have history behind it.
        if (isSaved && page?.oldest !== undefined && page.oldest < oldestTime) {
          await loadOlderMessages(store, serverId, target, page.oldest);
          return;
        }
        setLoading(serverId, target, false);
        await showLostGaps(
          store,
          serverId,
          target,
          (lost) => lost.from < oldestTime,
        );
      })();
    },
  };
}

export async function loadOlderMessages(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  oldestTime: number,
): Promise<boolean> {
  const serverHasChathistory = serverSupportsChathistory(
    store.getState(),
    serverId,
  );
  if (!isEnabled(store)) {
    if (!serverHasChathistory) return false;
    ircClient.requestChathistoryBefore(
      serverId,
      target,
      new Date(oldestTime).toISOString(),
    );
    return true;
  }
  setLoading(serverId, target, true);
  try {
    const conversation = findConversation(store, serverId, target);
    const readBack = conversation && readBackEdge(store, conversation.key);
    const before = Math.min(oldestTime, readBack?.time ?? oldestTime);
    const [olderRow] = await olderDiskRows(store, serverId, target, 1);
    const plan = planLoadMore({
      oldestTime: before,
      newestOlderRowTime: olderRow?.time,
      gaps: await gapsFor(serverId, target.toLowerCase()),
      hasChathistory: serverHasChathistory,
    });
    if (plan.kind === "disk") {
      if (await replayOlderDiskPage(store, serverId, target)) return true;
      setLoading(serverId, target, false);
      return false;
    }
    if (plan.kind === "server") {
      const isSent = requestPageBefore(
        serverId,
        target,
        plan.before,
        ircClient.isChannel(serverId, target)
          ? diskFirstFill(store, serverId, target, before, plan.gap)
          : plan.gap && { gap: plan.gap },
      );
      if (!isSent) setLoading(serverId, target, false);
      return isSent;
    }
    await refreshHasMore(store, serverId, target, false);
    setLoading(serverId, target, false);
    return false;
  } catch (error) {
    setLoading(serverId, target, false);
    throw error;
  }
}

const WINDOW_ROWS = 50;

async function nextGapAfter(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  time: number,
): Promise<HistoryGap | undefined> {
  return (await gapsServerCanFill(store, serverId, target))
    .filter((gap) => gap.to > time)
    .sort((a, b) => a.from - b.from)[0];
}
const WINDOW_KEEP_MESSAGES = 300;
let jumpCounter = 0;

export type SavedJump = "loaded" | "not-saved" | "not-found";

// We show a message that is not loaded inside a window of the saved rows
// around it, so a jump costs the same at any depth. When the rows after it
// already reach the newest saved one, the window joins the present instead.
export async function showSavedMessagesAround(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  time: number,
  isCurrentJump: () => boolean = () => true,
): Promise<SavedJump> {
  if (!isEnabled(store)) return "not-saved";
  const lower = target.toLowerCase();
  const before = await rowsAboveGap(
    store,
    serverId,
    lower,
    time,
    await eventRowsBefore(serverId, lower, time, WINDOW_ROWS),
  );
  const last = before[before.length - 1];
  const hole = await nextGapAfter(store, serverId, lower, time);
  const after = (
    await eventRowsAfter(
      serverId,
      lower,
      last?.time ?? time,
      WINDOW_ROWS,
      last?.id,
    )
  ).filter((row) => !hole || row.time <= hole.from);
  const rows = [...before, ...after];
  if (!rows.some((row) => row.time === time)) return "not-saved";
  const conversation = findConversation(store, serverId, target);
  if (!conversation) return "not-found";
  if (after.length < WINDOW_ROWS && !hole) {
    await replayRows(store, serverId, target, rows, () => {
      if (!isCurrentJump()) return false;
      showPresent(store, serverId, target);
      return true;
    });
    return "loaded";
  }
  const newest = rows[rows.length - 1];
  const jumpId = ++jumpCounter;
  await replayRows(store, serverId, target, rows, () => {
    if (!isCurrentJump()) return false;
    store.setState((state) => ({
      messages: { ...state.messages, [conversation.key]: [] },
      historyWindows: {
        ...state.historyWindows,
        [conversation.key]: {
          until: newest.time,
          untilRowId: newest.id,
          present:
            state.historyWindows[conversation.key]?.present ??
            state.messages[conversation.key] ??
            [],
          jumpId,
        },
      },
    }));
    return true;
  });
  return "loaded";
}

// A short page means the window has reached the newest saved row.
export async function loadNewerMessages(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): Promise<void> {
  const conversation = findConversation(store, serverId, target);
  const window =
    conversation && store.getState().historyWindows[conversation.key];
  if (!conversation || !window) return;
  const shown = new Set(
    (store.getState().messages[conversation.key] ?? [])
      .filter((m) => messageTime(m) === window.until)
      .flatMap((m) => [m.msgid, ...(m.multilineMessageIds ?? [])]),
  );
  // A gap above the window holds messages only the server has, so we read
  // our rows up to it and then fetch forward from its older edge.
  const hole = await nextGapAfter(
    store,
    serverId,
    target.toLowerCase(),
    window.until,
  );
  const rows = (
    await eventRowsAfter(
      serverId,
      target.toLowerCase(),
      window.until,
      WINDOW_ROWS + shown.size,
      window.untilRowId,
    )
  )
    .filter((row) => !row.msgid || !shown.has(row.msgid))
    .filter((row) => !hole || row.time <= hole.from)
    .slice(0, WINDOW_ROWS);
  if (rows.length === 0 && hole) {
    if (
      serverSupportsChathistory(store.getState(), serverId) &&
      (await fetchPageToDisk(
        serverId,
        target,
        "AFTER",
        Math.max(window.until, hole.from),
        hole,
      ))
    )
      await loadNewerMessages(store, serverId, target);
    return;
  }
  const isSameWindow = () => {
    const current = store.getState().historyWindows[conversation.key];
    return current?.until === window.until && current.jumpId === window.jumpId;
  };
  if (rows.length < WINDOW_ROWS && !hole) {
    if (!isSameWindow()) return;
    joinWindowToPresent(store, conversation.key);
    if (rows.length) await replayRows(store, serverId, target, rows);
    if (serverSupportsChathistory(store.getState(), serverId))
      ircClient.requestChathistoryLatest(serverId, target);
    return;
  }
  const newest = rows[rows.length - 1];
  await replayRows(store, serverId, target, rows, () => {
    const current = store.getState().historyWindows[conversation.key];
    if (!current || !isSameWindow()) return false;
    store.setState((state) => ({
      historyWindows: {
        ...state.historyWindows,
        [conversation.key]: {
          ...current,
          until: newest.time,
          untilRowId: newest.id,
        },
      },
    }));
    return true;
  });
  if (dropOldestInWindow(store, conversation.key))
    await refreshHasMore(store, serverId, target, false);
}

// We cap a window at WINDOW_KEEP_MESSAGES while paging newer, and the chat list
// corrects its scroll position for the dropped rows.
function dropOldestInWindow(store: StoreApi<AppState>, key: string): boolean {
  const { messages, historyWindows } = store.getState();
  const shown = messages[key] ?? [];
  if (!historyWindows[key] || shown.length <= WINDOW_KEEP_MESSAGES)
    return false;
  store.setState((state) => ({
    messages: {
      ...state.messages,
      [key]: (state.messages[key] ?? []).slice(-WINDOW_KEEP_MESSAGES),
    },
  }));
  return true;
}

// On a chathistory server we ask for the newest page as on join, so messages
// only the server has come back too.
export function showPresent(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): void {
  const conversation = findConversation(store, serverId, target);
  const window =
    conversation && store.getState().historyWindows[conversation.key];
  if (!conversation || !window) return;
  store.setState((state) => {
    const { [conversation.key]: _, ...others } = state.historyWindows;
    return {
      historyWindows: others,
      messages: { ...state.messages, [conversation.key]: window.present },
    };
  });
  if (serverSupportsChathistory(store.getState(), serverId))
    ircClient.requestChathistoryLatest(serverId, target);
  else if (window.present.length === 0 && isEnabled(store))
    void replayNewestPage(store, serverId, target);
}

// A window paged down to the present joins it below, so the rows on screen stay.
function joinWindowToPresent(store: StoreApi<AppState>, key: string) {
  store.setState((state) => {
    const window = state.historyWindows[key];
    if (!window) return {};
    const { [key]: _, ...others } = state.historyWindows;
    return {
      historyWindows: others,
      messages: {
        ...state.messages,
        [key]: joinPresent(state.messages[key] ?? [], window.present),
      },
    };
  });
}

function joinPresent(present: Message[], arrived: Message[]): Message[] {
  const known = new Set(present.flatMap((m) => [m.id, m.msgid]));
  return [
    ...present,
    ...arrived.filter((m) => !known.has(m.id) && !known.has(m.msgid)),
  ]
    .sort((a, b) => messageTime(a) - messageTime(b))
    .slice(-MAX_MESSAGES_PER_CHANNEL);
}

// A chat showing the past keeps nothing newer than its window on screen, so
// we move whatever arrives into the present it shows again on return.
function moveArrivalsToPresent(state: AppState): Partial<AppState> | null {
  let { messages, historyWindows } = state;
  for (const [key, window] of Object.entries(state.historyWindows)) {
    const shown = state.messages[key] ?? [];
    const newest = shown[shown.length - 1];
    if (!newest || messageTime(newest) <= window.until) continue;
    messages = {
      ...messages,
      [key]: shown.filter((m) => messageTime(m) <= window.until),
    };
    historyWindows = {
      ...historyWindows,
      [key]: {
        ...window,
        present: joinPresent(
          window.present,
          shown.filter((m) => messageTime(m) > window.until),
        ),
      },
    };
  }
  return messages === state.messages ? null : { messages, historyWindows };
}
