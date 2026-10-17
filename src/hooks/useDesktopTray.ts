import { useEffect } from "react";
import {
  createDesktopTray,
  showUnreadState,
  unreadLevel,
  unreadTotals,
} from "../lib/desktopTray";
import { isTauriDesktop } from "../lib/platformUtils";
import useStore, { type AppState } from "../store";

export function useDesktopTray(): void {
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let shownKey = "";
    const update = (state: AppState) => {
      const { unread, mentions } = unreadTotals(state.servers);
      const level = unreadLevel(unread, mentions);
      const key = `${level}:${mentions}`;
      if (key === shownKey) return;
      shownKey = key;
      void showUnreadState(level, mentions);
    };
    void createDesktopTray(
      () => useStore.getState().globalSettings.closeToTray,
    ).then(() => update(useStore.getState()));
    return useStore.subscribe(update);
  }, []);
}
