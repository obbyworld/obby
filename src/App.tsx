import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import { ServerNoticesPopup } from "./components/message/ServerNoticesPopup";
import PrivacyPolicy from "./components/PrivacyPolicy";
import AddServerModal from "./components/ui/AddServerModal";
import ChannelListModal from "./components/ui/ChannelListModal";
import { EditServerModal } from "./components/ui/EditServerModal";
import LinkSecurityWarningModal from "./components/ui/LinkSecurityWarningModal";
import LoadingOverlay from "./components/ui/LoadingOverlay";
import QuickActions from "./components/ui/QuickActions";
import { TicTacToeModal } from "./components/ui/TicTacToeModal";
import { TotpStepUpModal } from "./components/ui/TotpStepUpModal";
import { TwoFactorSettingsModal } from "./components/ui/TwoFactorSettingsModal";
import UserProfileModal from "./components/ui/UserProfileModal";
import UserSettings from "./components/ui/UserSettings";
import { useChannelTabSwitching } from "./hooks/useChannelTabSwitching";
import { useConnectionResilience } from "./hooks/useConnectionResilience";
import { useKeyboardResize } from "./hooks/useKeyboardResize";
import ircClient from "./lib/ircClient";
import { parseIrcUrl } from "./lib/ircUrlParser";
import { isTauri } from "./lib/platformUtils";
import useStore, { loadSavedServers } from "./store";
import type { ConnectionDetails } from "./store/types";

const askPermissions = async () => {
  // Do you have permission to send a notification?
  let permissionGranted = await isPermissionGranted();

  // If not we need to request it
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }
};

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
        // forms.  Default to a `#` prefix when the caller passed a
        // bare channel name; sigils &, ^, $ are preserved verbatim.
        const first = trimmed.charAt(0);
        pendingJoinChannel =
          first === "#" || first === "&" || first === "^" || first === "$"
            ? trimmed
            : `#${trimmed}`;
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
  const host = __DEFAULT_IRC_SERVER__
    ? __DEFAULT_IRC_SERVER__.split(":")[1].replace(/^\/\//, "")
    : undefined;
  const port = __DEFAULT_IRC_SERVER__
    ? __DEFAULT_IRC_SERVER__.split(":")[2]
    : undefined;
  if (!host || !port) {
    return;
  }
  if (!__DEFAULT_IRC_SERVER_NAME__) {
  }
  toggleAddServerModal(true, {
    name: __DEFAULT_IRC_SERVER_NAME__ || "Obsidian IRC",
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

const App: React.FC = () => {
  const {
    toggleAddServerModal,
    toggleEditServerModal,
    toggleQuickActions,
    toggleTwoFactorSettings,
    ui: {
      isAddServerModalOpen,
      isChannelListModalOpen,
      isServerNoticesPopupOpen,
      isEditServerModalOpen,
      isSettingsModalOpen,
      isQuickActionsOpen,
      isUserProfileModalOpen,
      isTwoFactorSettingsOpen,
      editServerId,
      twoFactorSettingsServerId,
      linkSecurityWarnings,
      profileViewRequest,
      prefillServerDetails,
    },
    joinChannel,
    selectChannel,
    connectToSavedServers,
    toggleServerNoticesPopup,
    clearProfileViewRequest,
    messages,
    isConnecting,
    servers,
    hasConnectedToSavedServers,
  } = useStore();

  // Local state for User Profile modal
  const [userProfileModalState, setUserProfileModalState] = useState<{
    isOpen: boolean;
    serverId: string;
    username: string;
  } | null>(null);

  // Watch for profile view requests
  useEffect(() => {
    if (profileViewRequest) {
      setUserProfileModalState({
        isOpen: true,
        serverId: profileViewRequest.serverId,
        username: profileViewRequest.username,
      });
      clearProfileViewRequest();
    }
  }, [profileViewRequest, clearProfileViewRequest]);

  // Collect all server notices from all channels
  const serverNotices = Object.values(messages)
    .flat()
    .filter((message) => message.type === "notice" && message.jsonLogData)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

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

  // askPermissions();
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
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
    if (isAddServerModalOpen) return;
    if (servers.length === 0) return;
    // Wait until every server has settled (not still connecting/reconnecting)
    if (
      servers.some(
        (s) =>
          s.connectionState === "connecting" ||
          s.connectionState === "reconnecting",
      )
    )
      return;
    if (servers.some((s) => s.isConnected)) return;

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
    servers,
    hasConnectedToSavedServers,
    isAddServerModalOpen,
    toggleAddServerModal,
  ]);

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

  // Global keyboard shortcut for Quick Actions (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        toggleQuickActions();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleQuickActions]);

  // Suppress :hover popups on blur; reclaim focus from iframes immediately.
  useEffect(() => {
    const onBlur = () => {
      document.documentElement.classList.add("window-blurred");
      // Cross-origin iframes swallow all keystrokes — blur immediately so the parent document regains them.
      if (document.activeElement?.tagName === "IFRAME") {
        (document.activeElement as HTMLElement).blur();
      }
    };
    const onFocus = () =>
      document.documentElement.classList.remove("window-blurred");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <div className="h-screen overflow-hidden">
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route
          path="/*"
          element={
            <>
              <AppLayout />
              {isAddServerModalOpen && <AddServerModal />}
              {isEditServerModalOpen && editServerId && (
                <EditServerModal
                  serverId={editServerId}
                  onClose={() => toggleEditServerModal(false)}
                />
              )}
              {isTwoFactorSettingsOpen && twoFactorSettingsServerId && (
                <TwoFactorSettingsModal
                  serverId={twoFactorSettingsServerId}
                  onClose={() => toggleTwoFactorSettings(false)}
                />
              )}
              <TotpStepUpModal />
              <TicTacToeModal />
              {isSettingsModalOpen && <UserSettings />}
              {isQuickActionsOpen && <QuickActions />}
              {isChannelListModalOpen && <ChannelListModal />}
              <LinkSecurityWarningModal />
              {userProfileModalState?.isOpen && (
                <UserProfileModal
                  isOpen={userProfileModalState.isOpen}
                  onClose={() => setUserProfileModalState(null)}
                  serverId={userProfileModalState.serverId}
                  username={userProfileModalState.username}
                />
              )}
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
