import { useEffect } from "react";
import useStore, { type AppState, loadSavedServers } from "../../store";
import ircClient from "../ircClient";
import { isTauriMobile } from "../platformUtils";
import {
  configureHistoryPoll,
  historyPollConfigFor,
} from "./historyPollConfig";

/** Keeps the mobile history poll pointed at the servers that need it, from the
 *  moment the app last watched them live. */
export function useHistoryPoll(): void {
  useEffect(() => {
    if (!isTauriMobile()) return;
    let since = Date.now();
    const sync = (state: AppState) =>
      void configureHistoryPoll(
        historyPollConfigFor(
          state.servers,
          loadSavedServers(),
          state.globalSettings,
          {
            nickOf: (serverId) => ircClient.getNick(serverId),
            offersCapability: (serverId, cap) =>
              ircClient.offersCapability(serverId, cap),
          },
          since,
        ),
      ).catch((error) => console.warn("history poll config failed", error));
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
