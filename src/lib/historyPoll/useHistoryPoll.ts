import { useEffect } from "react";
import useStore, { type AppState, loadSavedServers } from "../../store";
import ircClient from "../ircClient";
import { areChatNotificationsOn } from "../notifications";
import { isTauriMobile } from "../platformUtils";
import {
  configureHistoryPoll,
  historyPollConfigFor,
  isHistoryPollDecided,
  type LiveServerState,
} from "./historyPollConfig";

export function useHistoryPoll(): void {
  useEffect(() => {
    if (!isTauriMobile()) return;
    // The poll reads history from when the app last watched the servers live.
    let since = Date.now();
    const live: LiveServerState = {
      nickOf: (serverId) => ircClient.getNick(serverId),
      offersCapability: (serverId, cap) =>
        ircClient.offersCapability(serverId, cap),
      hasCapability: (serverId, cap) => ircClient.hasCapability(serverId, cap),
    };
    const sync = (state: AppState) => {
      if (
        areChatNotificationsOn(state.globalSettings) &&
        !isHistoryPollDecided(state.servers, live)
      )
        return;
      void configureHistoryPoll(
        historyPollConfigFor(
          state.servers,
          loadSavedServers(),
          state.globalSettings,
          live,
          since,
        ),
      ).catch((error) => console.warn("history poll config failed", error));
    };
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
