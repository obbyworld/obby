// Everything a private message causes besides the row itself: last activity,
// unread and mention counts, the notification sound, and the browser
// notification. Encrypted messages are decrypted on a separate path and never
// reach the inbound PRIVMSG handler, so this lives on its own rather than
// inside either one: an encrypted conversation has to be as noticeable as a
// plaintext one.

import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  playNotificationSound,
  shouldPlayNotificationSound,
} from "../../lib/notificationSounds";
import { showMentionNotification } from "../../lib/notifications";
import type { Message } from "../../types";
import { getCurrentSelection } from "../helpers";
import type { AppState } from "../index";

export interface PrivateMessageArrival {
  serverId: string;
  privateChatId: string;
  sender: string;
  message: Message;
  body: string;
  isHistorical: boolean;
}

export function notePrivateMessageArrived(
  store: StoreApi<AppState>,
  arrival: PrivateMessageArrival,
): void {
  const { serverId, privateChatId, sender, body, isHistorical } = arrival;

  if (!isHistorical) {
    const state = store.getState();
    if (
      shouldPlayNotificationSound(
        arrival.message,
        ircClient.getCurrentUser(serverId),
        state.globalSettings,
      )
    ) {
      playNotificationSound(state.globalSettings);
    }
  }

  store.setState((state) => ({
    servers: state.servers.map((s) => {
      if (s.id !== serverId) return s;
      return {
        ...s,
        privateChats:
          s.privateChats?.map((pc) => {
            if (pc.id !== privateChatId) return pc;
            const isActive =
              getCurrentSelection(state).selectedPrivateChatId === pc.id;
            const reset = isActive || isHistorical;
            return {
              ...pc,
              lastActivity: new Date(),
              unreadCount: reset ? 0 : pc.unreadCount + 1,
              mentionCount: reset ? 0 : (pc.mentionCount ?? 0) + 1,
              // A PM is addressed to you by construction, so it counts as a
              // mention.
              isMentioned: !isHistorical,
            };
          }) || [],
      };
    }),
  }));

  const current = store.getState();
  const isActiveChat =
    getCurrentSelection(current).selectedPrivateChatId === privateChatId;
  if (
    isActiveChat ||
    isHistorical ||
    !current.globalSettings.enableNotifications
  )
    return;
  showMentionNotification(
    serverId,
    `DM from ${sender}`,
    sender,
    body,
    (id, msg) => {
      store.getState().addGlobalNotification({
        type: "note",
        command: "PRIVMSG",
        code: "DM",
        message: msg,
        serverId: id,
      });
    },
  );
}
