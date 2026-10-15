import { useEffect } from "react";
import {
  createDesktopTray,
  showUnreadState,
  unreadLevel,
  unreadTotals,
} from "../lib/desktopTray";
import { isTauriDesktop } from "../lib/platformUtils";
import useStore, { type AppState } from "../store";

/** Keeps a tray icon on desktop that shows whether anything is unread. */
export function useDesktopTray(): void {
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let shown = "";
    const update = (state: AppState) => {
      const { unread, mentions } = unreadTotals(state.servers);
      const level = unreadLevel(unread, mentions);
      const key = `${level}:${mentions}`;
      if (key === shown) return;
      shown = key;
      void showUnreadState(level, mentions);
    };
    void createDesktopTray(
      () => useStore.getState().globalSettings.closeToTray,
    ).then(() => update(useStore.getState()));
    return useStore.subscribe(update);
  }, []);
}
