// The stage and the pop-out (VoicePipOverlay) show the same call, and the call
// view remounts on every rotation, so the per-call view choices live at module
// scope beside the live-call registry in voice.ts.

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const clearers: Array<(k: string) => void> = [];

function key(serverId: string, channel: string): string {
  return `${serverId}\x00${channel}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function callScoped<T>(fallback: T) {
  const values = new Map<string, T>();
  clearers.push((k) => values.delete(k));

  const get = (serverId: string, channel: string): T =>
    values.get(key(serverId, channel)) ?? fallback;

  const set = (serverId: string, channel: string, value: T): void => {
    if (get(serverId, channel) === value) return;
    values.set(key(serverId, channel), value);
    notify();
  };

  const use = (
    serverId: string | undefined,
    channel: string | undefined,
  ): [T, (value: T) => void] => {
    const value = useSyncExternalStore(
      subscribe,
      () => (serverId && channel ? get(serverId, channel) : fallback),
      () => fallback,
    );
    const setValue = useCallback(
      (next: T) => {
        if (serverId && channel) set(serverId, channel, next);
      },
      [serverId, channel],
    );
    return [value, setValue];
  };

  return { set, use };
}

const spotlight = callScoped<string | null>(null);
const theater = callScoped(false);

export const setSpotlight = spotlight.set;
export const useSpotlight = spotlight.use;
export const setTheater = theater.set;
export const useTheater = theater.use;

/** Forgets the view choices of a call that ended, so the next call in the
 *  channel opens on the default layout. */
export function clearCallView(serverId: string, channel: string): void {
  for (const clear of clearers) clear(key(serverId, channel));
  notify();
}
