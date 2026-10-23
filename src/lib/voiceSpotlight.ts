// The member a user pins large on the stage has to still be the pinned
// member once the call floats into the pop-out (VoicePipOverlay), and
// picking someone in the pop-out has to carry back into the channel
// view -- so this lives at module scope instead of in either
// component's local state, mirroring the live-call registry pattern in
// voice.ts.

import { useCallback, useSyncExternalStore } from "react";

const spotlights = new Map<string, string | null>();
const listeners = new Set<() => void>();

function key(serverId: string, channel: string): string {
  return `${serverId}\x00${channel}`;
}

export function getSpotlight(serverId: string, channel: string): string | null {
  return spotlights.get(key(serverId, channel)) ?? null;
}

export function setSpotlight(
  serverId: string,
  channel: string,
  nick: string | null,
): void {
  const k = key(serverId, channel);
  if ((spotlights.get(k) ?? null) === nick) return;
  spotlights.set(k, nick);
  for (const listener of listeners) listener();
}

export function subscribeSpotlight(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shared spotlight for one (server, channel) call, and a setter
 *  that both the stage and the pop-out can call interchangeably. */
export function useSpotlight(
  serverId: string | undefined,
  channel: string | undefined,
): [string | null, (nick: string | null) => void] {
  const nick = useSyncExternalStore(
    subscribeSpotlight,
    () => (serverId && channel ? getSpotlight(serverId, channel) : null),
    () => null,
  );
  const setNick = useCallback(
    (n: string | null) => {
      if (serverId && channel) setSpotlight(serverId, channel, n);
    },
    [serverId, channel],
  );
  return [nick, setNick];
}
