// Per-server most-recently-selected channel/private-chat ids, most recent
// first. Backs both the Ctrl+Tab "previous item" indicator and the
// call-return memory, so there is exactly one place that knows what a user
// had open -- however the selection arrived (a click, Ctrl+Tab, or a
// restored startup selection). Store-agnostic on purpose: the store imports
// this module, never the other way round.

const MAX_ENTRIES = 30;

const history = new Map<string, string[]>();
let suspended = false;

/** Moves `itemId` to the front of `serverId`'s history, deduping any
 * earlier occurrence. A no-op while recording is suspended. */
export function recordSelection(serverId: string, itemId: string): void {
  if (suspended) return;
  const list = history.get(serverId) ?? [];
  if (list[0] === itemId) return;
  history.set(
    serverId,
    [itemId, ...list.filter((id) => id !== itemId)].slice(0, MAX_ENTRIES),
  );
}

/** Most-recent-first ids for `serverId`. Never mutate the result in place. */
export function getSelectionHistory(serverId: string): string[] {
  return history.get(serverId) ?? [];
}

// Ctrl+Tab steps through items without committing them to history until the
// key is released, so the caller suspends recording for the session and
// resumes it once the final selection is known.
export function suspendRecording(): void {
  suspended = true;
}

export function resumeRecording(): void {
  suspended = false;
}

export function clearSelectionHistory(): void {
  history.clear();
  suspended = false;
}
