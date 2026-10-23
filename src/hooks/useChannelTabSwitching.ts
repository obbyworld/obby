import { useEffect, useRef } from "react";
import { create } from "zustand";
import { arrangeChannels } from "../lib/channelFolders";
import {
  getSelectionHistory,
  recordSelection,
  resumeRecording,
  suspendRecording,
} from "../lib/channelHistory";
import { isTauri } from "../lib/platformUtils";
import useStore from "../store";
import { useChannelFolders } from "../store/channelFolders";

// Small store so ChannelList can reactively read which item is "previous"
// (the one Ctrl+Tab will jump to on next press)
interface ChannelMruState {
  prevItemId: string | null;
  setPrevItemId: (id: string | null) => void;
}

export const useChannelMru = create<ChannelMruState>((set) => ({
  prevItemId: null,
  setPrevItemId: (id) => set({ prevItemId: id }),
}));

type StoreState = ReturnType<typeof useStore.getState>;

type NavItem = { id: string; type: "channel" | "pm" };

// Returns all navigable items in visual sidebar order:
//   Channels (loose, then each folder) → Private chats (pinned-first, then by order)
function getSortedItems(state: StoreState): NavItem[] {
  const { selectedServerId } = state.ui;
  if (!selectedServerId) return [];

  const server = state.servers.find((s) => s.id === selectedServerId);
  if (!server) return [];

  // ── Channels ────────────────────────────────────────────────────────────
  const sortedChannels = arrangeChannels(
    server.channels.filter((c) => !c.isPrivate),
    state.channelOrder[selectedServerId],
    useChannelFolders.getState().folders[selectedServerId] ?? [],
  ).flatMap((group) => group.channels);

  const seen = new Set<string>();
  const channelItems: NavItem[] = sortedChannels
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .map((c) => ({ id: c.id, type: "channel" as const }));

  // ── Private chats ────────────────────────────────────────────────────────
  const privateChats = server.privateChats ?? [];
  const sortedPMs = [...privateChats].sort((a, b) => {
    if (a.isPinned && b.isPinned) return (a.order ?? 0) - (b.order ?? 0);
    if (a.isPinned) return -1;
    if (b.isPinned) return 1;
    return 0;
  });
  const pmItems: NavItem[] = sortedPMs.map((pc) => ({
    id: pc.id,
    type: "pm" as const,
  }));

  return [...channelItems, ...pmItems];
}

// Returns the ID of whatever is currently selected (channel or PM).
function getCurrentId(state: StoreState): string | null {
  const serverId = state.ui.selectedServerId;
  if (!serverId) return null;
  const sel = state.ui.perServerSelections[serverId];
  return sel?.selectedChannelId ?? sel?.selectedPrivateChatId ?? null;
}

// How it works:
//
//  • First Ctrl+Tab           → jump to last-used item (MRU)
//  • Ctrl held + Tab again    → advance one step linearly in visual order
//  • Ctrl held + Shift+Tab    → step backwards
//  • Release Ctrl             → commit; current item becomes new "previous"
//
// The sidebar shows a subtle amber left-border on the "previous" item
// so you always see where Ctrl+Tab will land before pressing it.

export function useChannelTabSwitching() {
  // Tracks last known selected ID per server to detect changes
  const lastIdRef = useRef<Map<string, string | null>>(new Map());

  const sessionActiveRef = useRef(false);
  const sessionIndexRef = useRef(-1);

  useEffect(() => {
    const { setPrevItemId } = useChannelMru.getState();

    const syncIndicator = (serverId: string) => {
      setPrevItemId(getSelectionHistory(serverId)[1] ?? null);
    };

    // History recording itself lives in the store (src/store/index.ts) so it
    // covers every platform and every way a selection can arrive, including
    // a restored startup selection. This subscription only keeps the amber
    // "previous item" indicator current -- and, on Tauri, feeds Ctrl+Tab.
    const unsubscribe = useStore.subscribe((state: StoreState) => {
      if (sessionActiveRef.current) return;

      const serverId = state.ui.selectedServerId;
      if (!serverId) return;

      const currentId = getCurrentId(state);
      const lastId = lastIdRef.current.get(serverId) ?? null;

      if (currentId !== lastId) {
        lastIdRef.current.set(serverId, currentId);
        if (currentId) syncIndicator(serverId);
      }
    });

    const initialServerId = useStore.getState().ui.selectedServerId;
    if (initialServerId) {
      lastIdRef.current.set(initialServerId, getCurrentId(useStore.getState()));
      syncIndicator(initialServerId);
    }

    // Browsers already own Ctrl+Tab, so only Tauri gets the shortcut itself.
    if (!isTauri()) {
      return unsubscribe;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "Tab") return;
      e.preventDefault();

      const state = useStore.getState();
      const serverId = state.ui.selectedServerId;
      if (!serverId) return;

      const items = getSortedItems(state);
      if (items.length < 2) return;

      const currentId = getCurrentId(state);

      if (!sessionActiveRef.current) {
        // ── First keypress: jump to last-used item ─────────────────────────
        sessionActiveRef.current = true;
        suspendRecording();

        const mru = getSelectionHistory(serverId);
        const itemIds = items.map((i) => i.id);

        if (!e.shiftKey) {
          const prevId = mru.find(
            (id) => id !== currentId && itemIds.includes(id),
          );
          if (prevId) {
            sessionIndexRef.current = itemIds.indexOf(prevId);
          } else {
            const cur = Math.max(0, itemIds.indexOf(currentId ?? ""));
            sessionIndexRef.current = (cur + 1) % items.length;
          }
        } else {
          const cur = items.findIndex((i) => i.id === currentId);
          sessionIndexRef.current =
            (cur >= 0 ? cur - 1 + items.length : items.length - 1) %
            items.length;
        }
      } else {
        // ── Subsequent keypresses: linear step ─────────────────────────────
        sessionIndexRef.current = e.shiftKey
          ? (sessionIndexRef.current - 1 + items.length) % items.length
          : (sessionIndexRef.current + 1) % items.length;
      }

      const target = items[sessionIndexRef.current];
      if (!target) return;

      const store = useStore.getState();
      if (target.type === "channel") {
        store.selectChannel(target.id);
      } else {
        store.selectPrivateChat(target.id, { navigate: true });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Control" || !sessionActiveRef.current) return;

      sessionActiveRef.current = false;
      resumeRecording();

      const state = useStore.getState();
      const serverId = state.ui.selectedServerId;
      if (!serverId) return;

      const currentId = getCurrentId(state);
      if (currentId) {
        recordSelection(serverId, currentId);
        lastIdRef.current.set(serverId, currentId);
        syncIndicator(serverId);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      unsubscribe();
    };
  }, []);
}
