// Drip-feeds METADATA LIST commands to the server so a "scroll-stops on
// 30 unfamiliar nicks" burst, or a sudden run of speakers in a busy
// channel, doesn't fire 30 lines at once and trip UnrealIRCd's recvq
// flood protection (issue #116). Existing deduplication lives in the
// store action -- this module only handles pacing.
//
// At ~5 requests/sec the network cost is amortised: a 200-user channel
// where everything is cold takes ~40 s to fully populate, but the user
// can use the channel immediately and population happens in the
// background as users scroll / speak.

import type ircClientType from "../lib/ircClient";

// 200 ms per dispatch == 5 requests/sec, comfortably under UnrealIRCd's
// default per-user recvq drain and well below most server-side flood
// thresholds.
const DRIP_INTERVAL_MS = 200;

interface QueueEntry {
  serverId: string;
  target: string;
}

let queue: QueueEntry[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
let injectedClient: typeof ircClientType | undefined;

function tick() {
  const next = queue.shift();
  if (!next) {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    return;
  }
  const client = injectedClient;
  if (!client) return;
  client.metadataList(next.serverId, next.target);
}

export function enqueueMetadataList(
  client: typeof ircClientType,
  serverId: string,
  target: string,
): void {
  injectedClient = client;
  // Coalesce duplicates that slipped past the store-level dedup (e.g.
  // a speaker who's also visible in the nicklist).
  if (queue.some((e) => e.serverId === serverId && e.target === target)) {
    return;
  }
  queue.push({ serverId, target });
  if (!timer) {
    timer = setInterval(tick, DRIP_INTERVAL_MS);
  }
}

// Test-only helpers.
export function _resetMetadataLazyQueue(): void {
  queue = [];
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  injectedClient = undefined;
}

export function _peekMetadataLazyQueue(): QueueEntry[] {
  return queue.slice();
}
