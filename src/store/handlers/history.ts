import type { StoreApi } from "zustand";
import { e2eeSessionKey, isEncryptionEngaged } from "../../lib/e2ee/session";
import {
  addGap,
  adoptParkedHistory,
  appendRows,
  deleteGap,
  deleteMessage,
  deleteServerHistory,
  eventRowsBefore,
  gapsFor,
  type HistoryGap,
  type HistoryRow,
  hasServerHistory,
  type NewHistoryRow,
  newestEventRows,
  parkServerHistory,
  pruneToLimit,
  refRowsFor,
  updateGap,
} from "../../lib/history/historyDb";
import {
  buildReplayLines,
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
import ircClient from "../../lib/ircClient";
import { parseMessageTags } from "../../lib/ircUtils";
import type { Server } from "../../types";
import { normalizeHost, serverSupportsChathistory } from "../helpers";
import type { AppState } from "../index";

const SERVER_PAGE_SIZE = 50;
export const BYTES_PER_MB = 1_000_000;
const PRUNE_EVERY_WRITES = 200;
const MAX_AUTO_FILL_PAGES = 10;

type GapFill = { gap: HistoryGap; pagesLeft?: number };

type PendingRequest =
  | { kind: "latest"; newestStoredTime: Promise<number | undefined> }
  | { kind: "before"; fill?: GapFill };

const recorders = new Map<string, HistoryRecorder>();
const pendingRequests = new Map<string, PendingRequest[]>();
// The gap a BEFORE request is about to fill. We attach it when the line
// actually leaves, so a request the socket dropped never claims a reply.
let nextGapFill: GapFill | undefined;
const shownConversations = new Set<string>();
let writesSincePrune = 0;
let replayCounter = 0;

// Removed and re-added servers find their parked history by this address.
function serverAddress(server: Pick<Server, "host" | "port">): string {
  return `${normalizeHost(server.host).toLowerCase()}:${server.port}`;
}

export function hasSavedHistory(serverId: string): Promise<boolean> {
  return hasServerHistory(serverId);
}

export function forgetSavedHistory(serverId: string): Promise<void> {
  return deleteServerHistory(serverId);
}

export function parkSavedHistory(server: Server): Promise<void> {
  return parkServerHistory(server.id, serverAddress(server));
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

  if (request?.kind === "latest") {
    const decision = decideAfterLatest({
      newestStoredTime: await request.newestStoredTime,
      page,
      limit: SERVER_PAGE_SIZE,
    });
    if (decision.kind === "add") {
      const { from, to, lost } = decision;
      await addGap({ server: key, target, from, to, lost });
      const [gap] = (await gapsFor(key, target)).filter(
        (g) => g.from === from && g.to === to,
      );
      if (gap) settleGap(store, serverId, target, gap, MAX_AUTO_FILL_PAGES);
    }
  } else if (request?.kind === "before" && request.fill) {
    const { gap: filled, pagesLeft } = request.fill;
    const decision = decideAfterGapFill({
      gap: filled,
      page,
      inserted,
      limit: SERVER_PAGE_SIZE,
    });
    if (decision.kind === "close") {
      if (filled.id !== undefined) await deleteGap(filled.id);
    } else {
      const gap = { ...filled, to: decision.to, lost: decision.lost };
      await updateGap(gap);
      if (pagesLeft !== undefined)
        settleGap(store, serverId, target, gap, pagesLeft);
    }
  }
  await refreshHasMore(store, serverId, target, page.size >= SERVER_PAGE_SIZE);
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

// Rows on disk older than the oldest message on screen. Messages can share a
// millisecond, so we read past the ones on screen and skip them by msgid.
async function olderDiskRows(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  limit: number,
): Promise<HistoryRow[]> {
  const conversation = findConversation(store, serverId, target);
  const messages = conversation
    ? (store.getState().messages[conversation.key] ?? [])
    : [];
  if (messages.length === 0)
    return newestEventRows(serverId, target.toLowerCase(), limit);
  const oldest = new Date(messages[0].timestamp).getTime();
  const sameMs = messages.filter(
    (m) => new Date(m.timestamp).getTime() === oldest,
  );
  const shown = new Set(
    sameMs.flatMap((m) => [m.msgid, ...(m.multilineMessageIds ?? [])]),
  );
  const rows = await eventRowsBefore(
    serverId,
    target.toLowerCase(),
    oldest,
    limit + sameMs.length,
  );
  return rows
    .filter((row) => !row.msgid || !shown.has(row.msgid))
    .slice(-limit);
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
  if (gap.lost || pagesLeft === 0) {
    showMissingMarker(store, serverId, conversation.channelId, gap);
    return;
  }
  nextGapFill = { gap, pagesLeft: pagesLeft - 1 };
  ircClient.sendRaw(
    serverId,
    `CHATHISTORY BEFORE ${target} timestamp=${new Date(gap.to).toISOString()} ${SERVER_PAGE_SIZE}`,
  );
  nextGapFill = undefined;
}

function findConversation(
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
  const request = /^CHATHISTORY (LATEST|BEFORE) (\S+)/.exec(line);
  if (request) {
    const target = request[2].toLowerCase();
    const queue = pendingRequests.get(conversationKey(serverId, target)) ?? [];
    queue.push(
      request[1] === "LATEST"
        ? {
            kind: "latest",
            newestStoredTime: newestEventRows(serverId, target, 1).then(
              ([row]) => row?.time,
            ),
          }
        : { kind: "before", fill: nextGapFill },
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
  ircClient.on("parsedLine", ({ serverId, ...parsed }) => {
    if (!isEnabled(store)) return;
    for (const action of recorderFor(store, serverId).feed(parsed))
      void persistHistoryAction(store, serverId, action);
  });

  ircClient.on("rawLine", ({ serverId, direction, line }) => {
    if (direction === "tx" && isEnabled(store))
      trackOutgoing(store, serverId, line);
  });

  ircClient.on("connectionStateChange", ({ serverId, connectionState }) => {
    if (connectionState === "connected") {
      const server = ircClient.servers.get(serverId);
      if (server) void adoptParkedHistory(serverAddress(server), serverId);
      return;
    }
    for (const key of pendingRequests.keys())
      if (key.startsWith(`${serverId}\n`)) pendingRequests.delete(key);
  });
}

// On a server without history our disk is the only source, so we show its
// newest page the first time a chat is opened in this session.
export function showSavedHistory(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
): void {
  const key = conversationKey(serverId, target);
  if (
    !isEnabled(store) ||
    serverSupportsChathistory(store.getState(), serverId)
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
) {
  const msgids = rows.flatMap((row) => (row.msgid ? [row.msgid] : []));
  const reactions = msgids.length ? await refRowsFor(serverId, msgids) : [];
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
  if (rows.length) await markLostGaps(store, serverId, target, rows);
  await refreshHasMore(
    store,
    serverId,
    target,
    serverSupportsChathistory(store.getState(), serverId),
  );
}

async function markLostGaps(
  store: StoreApi<AppState>,
  serverId: string,
  target: string,
  rows: HistoryRow[],
) {
  const conversation = findConversation(store, serverId, target);
  if (!conversation) return;
  const oldest = rows[0].time;
  const newest = rows[rows.length - 1].time;
  for (const gap of await gapsFor(serverId, target.toLowerCase()))
    if (gap.lost && gap.from >= oldest && gap.from <= newest)
      showMissingMarker(store, serverId, conversation.channelId, gap);
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
    const [olderRow] = await olderDiskRows(store, serverId, target, 1);
    const plan = planLoadMore({
      oldestTime,
      newestOlderRowTime: olderRow?.time,
      gaps: await gapsFor(serverId, target.toLowerCase()),
      hasChathistory: serverHasChathistory,
    });
    if (plan.kind === "disk") {
      const rows = await olderDiskRows(
        store,
        serverId,
        target,
        HISTORY_PAGE_SIZE,
      );
      await replayRows(store, serverId, target, rows);
      return true;
    }
    if (plan.kind === "server") {
      nextGapFill = plan.gap ? { gap: plan.gap } : undefined;
      ircClient.requestChathistoryBefore(
        serverId,
        target,
        new Date(plan.before).toISOString(),
      );
      nextGapFill = undefined;
      return true;
    }
    await refreshHasMore(store, serverId, target, false);
    setLoading(serverId, target, false);
    return false;
  } catch (error) {
    setLoading(serverId, target, false);
    throw error;
  }
}
