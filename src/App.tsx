import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type React from "react";
import { useEffect, useRef } from "react";
import { Route, Routes } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import AppLayout from "./components/layout/AppLayout";
import { ServerNoticesPopup } from "./components/message/ServerNoticesPopup";
import PrivacyPolicy from "./components/PrivacyPolicy";
import AddServerModal from "./components/ui/AddServerModal";
import { BouncerDisconnectConfirmModal } from "./components/ui/BouncerDisconnectConfirmModal";
import { BouncerNetworkDisconnectConfirmModal } from "./components/ui/BouncerNetworkDisconnectConfirmModal";
import LinkSecurityWarningModal from "./components/ui/LinkSecurityWarningModal";
import LoadingOverlay from "./components/ui/LoadingOverlay";
import QuickActions from "./components/ui/QuickActions";
import { RemoveServerConfirmModal } from "./components/ui/RemoveServerConfirmModal";
import { TicTacToeModal } from "./components/ui/TicTacToeModal";
import { TotpStepUpModal } from "./components/ui/TotpStepUpModal";
import { useChannelTabSwitching } from "./hooks/useChannelTabSwitching";
import { useConnectionResilience } from "./hooks/useConnectionResilience";
import { useDesktopTray } from "./hooks/useDesktopTray";
import { useKeyboardResize } from "./hooks/useKeyboardResize";
import { showMainWindow } from "./lib/desktopTray";
import { whenHistoryIdle } from "./lib/history/historyDb";
import { useHistoryPoll } from "./lib/historyPoll/useHistoryPoll";
import ircClient from "./lib/ircClient";
import { parseIrcUrl } from "./lib/ircUrlParser";
import { isChannelTarget } from "./lib/ircUtils";
import { jumpToMessage } from "./lib/jumpToMessage";
import {
  handleNotificationTaps,
  type NotificationTarget,
} from "./lib/notifications";
import { isTauri, isTauriDesktop } from "./lib/platformUtils";
import useStore, { type AppState, loadSavedServers } from "./store";
import { offerNotificationsOnce } from "./store/handlers/chatNotifications";
import { isAppInFront } from "./store/helpers";
import type { ConnectionDetails } from "./store/types";

const CHAT_READY_TIMEOUT_MS = 30_000;

function isChatReady(
  state: AppState,
  { serverId, target }: NotificationTarget,
) {
  const server = state.servers.find((s) => s.id === serverId);
  if (!server?.isConnected) return false;
  if (!ircClient.isChannel(serverId, target)) return true;
  const lower = target.toLowerCase();
  return server.channels.some((c) => c.name.toLowerCase() === lower);
}

// A tap can launch the app, so we wait for the server to connect and rejoin
// the chat before we open it.
function whenChatReady(target: NotificationTarget): Promise<void> {
  return new Promise((resolve) => {
    if (isChatReady(useStore.getState(), target)) return resolve();
    const finish = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = useStore.subscribe((state) => {
      if (isChatReady(state, target)) finish();
    });
    const timer = setTimeout(finish, CHAT_READY_TIMEOUT_MS);
  });
}

async function openNotificationTarget(target: NotificationTarget) {
  if (isTauriDesktop()) await showMainWindow();
  await whenChatReady(target);
  const result = target.msgid ? await jumpToMessage(target) : null;
  if (!result?.ok) useStore.getState().openChat(target.serverId, target.target);
}

/* Channel auto-join from URL query string.
 *
 * When the hosted client is reached via an invite-page "Join via
 * Web" link the URL carries `?channel=<urlencoded>` (the obbyircd
 * invite-page module appends it on channel-specific invites). Read
 * the param once on module load, normalise the value, and stash for
 * the first `ready` event to consume.  The query param is stripped
 * from the visible address bar immediately so a refresh doesn't
 * silently re-fire the auto-join. */
let pendingJoinChannel: string | null = null;
if (typeof window !== "undefined") {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("channel");
    if (raw) {
      const trimmed = raw.trim();
      if (trimmed) {
        // Accept both encoded ("%23weather") and unencoded ("#weather")
        // forms, and give a bare channel name a `#` prefix.
        pendingJoinChannel = isChannelTarget(trimmed) ? trimmed : `#${trimmed}`;
      }
      // Strip the param so refreshes don't re-trigger.  Preserve any
      // other query params the host page may use.
      params.delete("channel");
      const remaining = params.toString();
      const newUrl =
        window.location.pathname +
        (remaining ? `?${remaining}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  } catch {
    /* malformed URL -- silently ignore */
  }
}

const initializeEnvSettings = (
  toggleAddServerModal: (
    isOpen?: boolean,
    prefillDetails?: ConnectionDetails | null,
  ) => void,
  joinChannel: (serverId: string, channelName: string) => void,
) => {
  if (loadSavedServers().length > 0) return;
  const [, scheme, hostname, port] =
    __DEFAULT_IRC_SERVER__?.match(/^(\w+):\/\/([^:/]+):(\d+)/) ?? [];
  // The client reads TLS from an irc:// or ircs:// host, so we keep that scheme.
  const host =
    scheme === "irc" || scheme === "ircs"
      ? `${scheme}://${hostname}:${port}`
      : hostname;
  if (!host || !port) {
    return;
  }
  if (!__DEFAULT_IRC_SERVER_NAME__) {
  }
  toggleAddServerModal(true, {
    name: __DEFAULT_IRC_SERVER_NAME__ || "Obby",
    host,
    port,
    nickname: "",
    ui: {
      hideServerInfo: true,
      hideClose: true,
      title: `Welcome to ${__DEFAULT_IRC_SERVER_NAME__}!`,
    },
  });
  ircClient.on("ready", ({ serverId, serverName, nickname }) => {
    // Automatically join default channels
    for (const channel of __DEFAULT_IRC_CHANNELS__) {
      joinChannel(serverId, channel);
    }
  });
};

const FOCUS_KEY_GRACE_MS = 300;

const collectServerNotices = (state: AppState) =>
  Object.values(state.messages)
    .flat()
    .filter((message) => message.type === "notice" && message.jsonLogData)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

const App: React.FC = () => {
  const {
    toggleAddServerModal,
    toggleQuickActions,
    isAddServerModalOpen,
    isServerNoticesPopupOpen,
    quickActions,
    joinChannel,
    selectChannel,
    connectToSavedServers,
    toggleServerNoticesPopup,
    isConnecting,
    hasConnectedToSavedServers,
  } = useStore(
    useShallow((state) => ({
      toggleAddServerModal: state.toggleAddServerModal,
      toggleQuickActions: state.toggleQuickActions,
      isAddServerModalOpen: state.ui.isAddServerModalOpen,
      isServerNoticesPopupOpen: state.ui.isServerNoticesPopupOpen,
      quickActions: state.ui.quickActions,
      joinChannel: state.joinChannel,
      selectChannel: state.selectChannel,
      connectToSavedServers: state.connectToSavedServers,
      toggleServerNoticesPopup: state.toggleServerNoticesPopup,
      isConnecting: state.isConnecting,
      hasConnectedToSavedServers: state.hasConnectedToSavedServers,
    })),
  );
  const hasEveryServerFailed = useStore(
    (state) =>
      state.servers.length > 0 &&
      !state.servers.some(
        (s) =>
          s.isConnected ||
          s.connectionState === "connecting" ||
          s.connectionState === "reconnecting",
      ),
  );
  // We only gather notices while the popup is open: this walks every message.
  const serverNotices = useStore(
    useShallow((state) =>
      state.ui.isServerNoticesPopupOpen ? collectServerNotices(state) : [],
    ),
  );

  // The composer is the only drop target. Anywhere else the webview follows the
  // file and replaces the app, which a native window offers no way back from.
  useEffect(() => {
    const cancel = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", cancel);
    window.addEventListener("drop", cancel);
    return () => {
      window.removeEventListener("dragover", cancel);
      window.removeEventListener("drop", cancel);
    };
  }, []);

  // Handlers for popup interactions
  const handleUsernameContextMenu = (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => {
    // For now, just prevent default. Could be extended to show user context menu
    e.preventDefault();
  };

  const handleIrcLinkClick = (url: string) => {
    const parsed = parseIrcUrl(url, "user");
    toggleAddServerModal(true, {
      name: parsed.host,
      host: parsed.host,
      port: parsed.port.toString(),
      nickname: parsed.nick || "user",
      useWebSocket: false,
    });
  };

  // Initialize keyboard resize handling for mobile platforms
  useKeyboardResize();
  useConnectionResilience();
  useChannelTabSwitching();
  useDesktopTray();
  useHistoryPoll();

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    void handleNotificationTaps(openNotificationTarget);
    offerNotificationsOnce(useStore);
    initializeEnvSettings(toggleAddServerModal, joinChannel);
    connectToSavedServers();

    /* Auto-join the channel encoded in `?channel=` on the URL the
     * user landed on.  Fires on the first server that finishes
     * registration so persistence reconnects and fresh connects both
     * get caught.  Channel pending state is module-scoped and
     * consumed exactly once. */
    if (pendingJoinChannel) {
      const onReady = ({ serverId }: { serverId: string }) => {
        if (!pendingJoinChannel) return;
        const channel = pendingJoinChannel;
        pendingJoinChannel = null;
        joinChannel(serverId, channel);
        // Wait a tick for the JOIN echo to register the channel in
        // the store, then focus it.  Same pattern UserProfileModal
        // uses for click-to-join.
        setTimeout(() => {
          const srv = useStore
            .getState()
            .servers.find((s) => s.id === serverId);
          const ch = srv?.channels.find((c) => c.name === channel);
          if (ch) selectChannel(ch.id, { navigate: true });
        }, 200);
        ircClient.deleteHook("ready", onReady);
      };
      ircClient.on("ready", onReady);
    }
  }, [connectToSavedServers, joinChannel, selectChannel, toggleAddServerModal]);

  // When the server list is hidden and all saved-server connections fail, the user
  // has no other way to open the login modal, so we open it automatically.
  useEffect(() => {
    if (!__HIDE_SERVER_LIST__) return;
    if (!hasConnectedToSavedServers) return;
    if (isAddServerModalOpen || !hasEveryServerFailed) return;

    const firstSaved = loadSavedServers()[0];
    toggleAddServerModal(
      true,
      firstSaved
        ? {
            name: firstSaved.name ?? firstSaved.host,
            host: firstSaved.host,
            port: String(firstSaved.port),
            nickname: firstSaved.nickname,
            ui: {
              hideServerInfo: true,
              hideClose: true,
            },
          }
        : null,
    );
  }, [
    hasEveryServerFailed,
    hasConnectedToSavedServers,
    isAddServerModalOpen,
    toggleAddServerModal,
  ]);

  // With the server list hidden, removing the only server leaves nothing to
  // pick, so we reload into the welcome prompt once its saved history is
  // deleted or parked.
  const hasServers = useStore((state) => state.servers.length > 0);
  const hadServersRef = useRef(false);
  useEffect(() => {
    if (!__HIDE_SERVER_LIST__) return;
    if (hasServers) hadServersRef.current = true;
    else if (hadServersRef.current)
      void whenHistoryIdle().then(() => window.location.reload());
  }, [hasServers]);

  // Handle deeplinks
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupDeepLinkHandler = async () => {
      if (!isTauri()) {
        return;
      }

      try {
        // Register handler for when app is already running; store unlisten for cleanup
        unlisten = await onOpenUrl((urls) => {
          console.log("Deep link received:", urls);

          for (const url of urls) {
            if (url.startsWith("irc://") || url.startsWith("ircs://")) {
              try {
                // Parse the IRC URL
                const parsed = parseIrcUrl(url);

                // Open the connect modal with pre-filled details
                toggleAddServerModal(true, {
                  name: parsed.host || "IRC Server",
                  host: parsed.host,
                  port: parsed.port.toString(),
                  nickname: parsed.nick || "user",
                  useWebSocket: false,
                });
              } catch (error) {
                console.error("Failed to parse IRC URL:", error);
              }
            }
          }
        });
      } catch (error) {
        console.error("Failed to setup deep link handler:", error);
      }
    };

    setupDeepLinkHandler();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [toggleAddServerModal]);

  // Cmd+K / Ctrl+K opens the palette in Go to and flips its mode once open.
  useEffect(() => {
    // A launcher that hands us focus with its own Cmd+K still held (Raycast)
    // delivers that keydown here, so we ignore the shortcut right after focus.
    let focusedAt = 0;
    const handleFocus = () => {
      focusedAt = performance.now();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "k") return;
      event.preventDefault();
      if (event.repeat || performance.now() - focusedAt < FOCUS_KEY_GRACE_MS)
        return;
      toggleQuickActions();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleQuickActions]);

  // Suppress :hover popups on blur; reclaim focus from iframes immediately.
  useEffect(() => {
    const setAppFocused = (isAppFocused: boolean) =>
      useStore.setState((state) =>
        state.ui.isAppFocused === isAppFocused
          ? {}
          : { ui: { ...state.ui, isAppFocused } },
      );
    const noteAppInFront = () => setAppFocused(isAppInFront());
    // Focus returning from an embedded player, or to the macOS webview, can
    // come without a focus event, so we take a click or a key press as the app in front.
    const noteInput = () =>
      setAppFocused(document.visibilityState === "visible");
    const onBlur = () => {
      noteAppInFront();
      document.documentElement.classList.add("window-blurred");
      // Cross-origin iframes swallow all keystrokes — blur immediately so the parent document regains them.
      if (document.activeElement?.tagName === "IFRAME") {
        (document.activeElement as HTMLElement).blur();
        setTimeout(noteAppInFront, 0);
      }
    };
    const onFocus = () => {
      noteAppInFront();
      document.documentElement.classList.remove("window-blurred");
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", noteAppInFront);
    document.addEventListener("pointerdown", noteInput, true);
    document.addEventListener("keydown", noteInput, true);
    const unlisteners: (() => void)[] = [];
    if (isTauri())
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("tauri://focus", () => setAppFocused(true)).then((off) =>
          unlisteners.push(off),
        );
        listen("tauri://blur", () => setAppFocused(false)).then((off) =>
          unlisteners.push(off),
        );
      });
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", noteAppInFront);
      document.removeEventListener("pointerdown", noteInput, true);
      document.removeEventListener("keydown", noteInput, true);
      for (const off of unlisteners) off();
    };
  }, []);

  return (
    <div className="h-full overflow-hidden">
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route
          path="/*"
          element={
            <>
              <AppLayout />
              {isAddServerModalOpen && <AddServerModal />}
              <BouncerDisconnectConfirmModal />
              <RemoveServerConfirmModal />
              <BouncerNetworkDisconnectConfirmModal />
              <TotpStepUpModal />
              <TicTacToeModal />
              {quickActions && <QuickActions />}
              <LinkSecurityWarningModal />
              {isServerNoticesPopupOpen && (
                <ServerNoticesPopup
                  messages={serverNotices}
                  onClose={() => toggleServerNoticesPopup(false)}
                  onUsernameContextMenu={handleUsernameContextMenu}
                  onIrcLinkClick={handleIrcLinkClick}
                  joinChannel={joinChannel}
                />
              )}
              {isConnecting && <LoadingOverlay />}
            </>
          }
        />
      </Routes>
    </div>
  );
};

export default App;
