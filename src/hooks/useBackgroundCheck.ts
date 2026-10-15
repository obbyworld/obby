import { useEffect } from "react";
import {
  backgroundConfigFor,
  configureBackgroundCheck,
} from "../lib/backgroundCheck";
import ircClient from "../lib/ircClient";
import { isTauriMobile } from "../lib/platformUtils";
import useStore, { type AppState, loadSavedServers } from "../store";

/** Keeps the mobile background check pointed at the servers that keep history
 *  for us, from the moment the app last watched them live. */
export function useBackgroundCheck(): void {
  useEffect(() => {
    if (!isTauriMobile()) return;
    let since = Date.now();
    const sync = (state: AppState) =>
      void configureBackgroundCheck(
        backgroundConfigFor(
          state.servers,
          loadSavedServers(),
          state.globalSettings,
          (serverId) => ircClient.getNick(serverId),
          since,
        ),
      ).catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      since = Date.now();
      sync(useStore.getState());
    };
    sync(useStore.getState());
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (
        state.servers !== previous.servers ||
        state.globalSettings !== previous.globalSettings
      )
        sync(state);
    });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
