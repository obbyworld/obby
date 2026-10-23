// Everything a private message causes besides the row itself: last activity,
// the notification sound, and the system notification. Encrypted messages are decrypted on a separate path and never
// reach the inbound PRIVMSG handler, so this lives on its own rather than
// inside either one: an encrypted conversation has to be as noticeable as a
// plaintext one.

import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  playNotificationSound,
  shouldPlayNotificationSound,
} from "../../lib/notificationSounds";
import { encryptedNotificationText } from "../../lib/notifications";
import type { Message } from "../../types";
import { getViewedSelection } from "../helpers";
import type { AppState } from "../index";
import { notifyChatMessage } from "./chatNotifications";

export interface PrivateMessageArrival {
  serverId: string;
  privateChatId: string;
  sender: string;
  message: Message;
  body: string;
  isHistorical: boolean;
  isEncrypted?: boolean;
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
            return { ...pc, lastActivity: laterActivity(pc, arrival.message) };
          }) || [],
      };
    }),
  }));

  const isActiveChat =
    getViewedSelection(store.getState()).selectedPrivateChatId ===
    privateChatId;
  if (isActiveChat || isHistorical) return;
  notifyChatMessage(store, {
    serverId,
    target: sender,
    sender,
    // We keep decrypted text out of the system's notification center.
    text: arrival.isEncrypted ? encryptedNotificationText() : body,
    isPrivate: true,
    time: new Date(arrival.message.timestamp).getTime(),
    msgid: arrival.message.msgid,
  });
}

// A replayed message carries its own server-time and must never move a chat
// back in the list.
export function laterActivity(
  chat: { lastActivity?: Date },
  message: { timestamp: Date },
): Date {
  const at = new Date(message.timestamp);
  return chat.lastActivity && new Date(chat.lastActivity) >= at
    ? chat.lastActivity
    : at;
}
