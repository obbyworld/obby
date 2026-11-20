import { getServerSelection } from "./helpers";
import type { AppState } from "./index";

// Servers charge lag per command, so we pace startup requests to keep the user's own messages from waiting behind them.
const FIRST_BATCH = 4;
const PACE_MS = 1000;

interface PacedRequest {
  key: string;
  send: () => void;
}

interface ServerQueue {
  requests: PacedRequest[];
  timer?: ReturnType<typeof setTimeout>;
}

const queues = new Map<string, ServerQueue>();

const isRequestFor = (key: string) => (request: PacedRequest) =>
  request.key.toLowerCase() === key.toLowerCase();

function sendNextPacedRequests(serverId: string, count: number): void {
  const queue = queues.get(serverId);
  if (!queue) return;
  try {
    for (let sent = 0; sent < count && queue.requests.length; sent++)
      queue.requests.shift()?.send();
  } finally {
    if (queue.requests.length)
      queue.timer = setTimeout(
        () => sendNextPacedRequests(serverId, 1),
        PACE_MS,
      );
    else queues.delete(serverId);
  }
}

export function sendPaced(
  serverId: string,
  key: string,
  send: () => void,
): void {
  let queue = queues.get(serverId);
  if (!queue) {
    queue = { requests: [] };
    queues.set(serverId, queue);
  }
  if (queue.requests.some(isRequestFor(key))) return;
  queue.requests.push({ key, send });
  queue.timer ??= setTimeout(
    () => sendNextPacedRequests(serverId, FIRST_BATCH),
    0,
  );
}

export function sendNowIfQueued(serverId: string, key: string): boolean {
  const requests = queues.get(serverId)?.requests;
  const index = requests?.findIndex(isRequestFor(key)) ?? -1;
  if (!requests || index === -1) return false;
  const [request] = requests.splice(index, 1);
  request.send();
  return true;
}

export function dropPacedRequest(serverId: string, key: string): void {
  const requests = queues.get(serverId)?.requests;
  const index = requests?.findIndex(isRequestFor(key)) ?? -1;
  if (requests && index !== -1) requests.splice(index, 1);
}

export function clearPacedRequests(serverId: string): void {
  clearTimeout(queues.get(serverId)?.timer);
  queues.delete(serverId);
}

function isOpenChat(
  state: Pick<AppState, "servers" | "ui">,
  serverId: string,
  target: string,
): boolean {
  const selection = getServerSelection(state, serverId);
  const server = state.servers.find((s) => s.id === serverId);
  const openChatName =
    server?.channels.find((c) => c.id === selection.selectedChannelId)?.name ??
    server?.privateChats?.find(
      (pc) => pc.id === selection.selectedPrivateChatId,
    )?.username;
  return openChatName?.toLowerCase() === target.toLowerCase();
}

export function sendOpenChatFirst(
  state: Pick<AppState, "servers" | "ui">,
  serverId: string,
  target: string,
  send: () => void,
): void {
  if (isOpenChat(state, serverId, target)) send();
  else sendPaced(serverId, target, send);
}
