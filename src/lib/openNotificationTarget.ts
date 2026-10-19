import useStore, { type AppState } from "../store";
import { saveMessagesAround } from "../store/handlers/history";
import { serverSupportsChathistory } from "../store/helpers";
import { showMainWindow } from "./desktopTray";
import ircClient from "./ircClient";
import { jumpToMessage } from "./jumpToMessage";
import type { NotificationTarget } from "./notifications";
import { isTauriDesktop } from "./platformUtils";

const CHAT_READY_TIMEOUT_MS = 30_000;

const findChannel = (
  state: AppState,
  { serverId, target }: NotificationTarget,
) =>
  state.servers
    .find((s) => s.id === serverId)
    ?.channels.find((c) => c.name.toLowerCase() === target.toLowerCase());

const isConnected = (state: AppState, serverId: string) =>
  state.servers.some((s) => s.id === serverId && s.isConnected);

// We keep saved channels across a reconnect before we have joined them again,
// so after a connect a channel is ready once its first history page is in.
function isChatReady(
  state: AppState,
  target: NotificationTarget,
  hasFetchedPage: boolean,
): boolean {
  if (!isConnected(state, target.serverId)) return false;
  if (!ircClient.isChannel(target.serverId, target.target)) return true;
  const channel = findChannel(state, target);
  if (!channel || channel.isLoadingHistory) return false;
  return hasFetchedPage || !serverSupportsChathistory(state, target.serverId);
}

// A tap can launch the app, so we wait for the server to connect, rejoin the
// chat and load its history, which brings the message we were not here for.
function whenChatReady(target: NotificationTarget): Promise<void> {
  return new Promise((resolve) => {
    let hasFetchedPage = isConnected(useStore.getState(), target.serverId);
    const isReady = (state: AppState) => {
      if (findChannel(state, target)?.isLoadingHistory) hasFetchedPage = true;
      return isChatReady(state, target, hasFetchedPage);
    };
    if (isReady(useStore.getState())) return resolve();
    const finish = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = useStore.subscribe((state) => {
      if (isReady(state)) finish();
    });
    const timer = setTimeout(finish, CHAT_READY_TIMEOUT_MS);
  });
}

// A tap wakes the app while its page is still hidden, and a hidden page drops the scroll to the message.
function whenVisible(): Promise<void> {
  return new Promise((resolve) => {
    if (document.visibilityState === "visible") return resolve();
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

const isLoaded = (msgid: string) =>
  Object.values(useStore.getState().messages).some((list) =>
    list.some(
      (m) => m.msgid === msgid || m.multilineMessageIds?.includes(msgid),
    ),
  );

// We look for the message before we open the chat, so a message the server no
// longer keeps opens the chat on its unread line.
async function canJumpTo({
  serverId,
  target,
  time,
  msgid,
}: NotificationTarget) {
  if (!msgid) return false;
  return (
    isLoaded(msgid) ||
    (await saveMessagesAround(useStore, serverId, target, time))
  );
}

export async function openNotificationTarget(
  target: NotificationTarget,
): Promise<void> {
  if (isTauriDesktop()) await showMainWindow();
  await whenChatReady(target);
  await whenVisible();
  const result = (await canJumpTo(target)) ? await jumpToMessage(target) : null;
  if (!result?.ok) useStore.getState().openChat(target.serverId, target.target);
}
