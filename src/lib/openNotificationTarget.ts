import useStore, { type AppState } from "../store";
import { showMainWindow } from "./desktopTray";
import ircClient from "./ircClient";
import { jumpToMessage } from "./jumpToMessage";
import type { NotificationTarget } from "./notifications";
import { isTauriDesktop } from "./platformUtils";

const CHAT_READY_TIMEOUT_MS = 30_000;

function isChatReady(
  state: AppState,
  { serverId, target }: NotificationTarget,
): boolean {
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

export async function openNotificationTarget(
  target: NotificationTarget,
): Promise<void> {
  if (isTauriDesktop()) await showMainWindow();
  await whenChatReady(target);
  const result = target.msgid ? await jumpToMessage(target) : null;
  if (!result?.ok) useStore.getState().openChat(target.serverId, target.target);
}
