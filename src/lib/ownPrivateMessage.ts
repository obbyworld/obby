import { v4 as uuidv4 } from "uuid";
import useStore from "../store";
import type { Message, PrivateChat, User } from "../types";
import ircClient from "./ircClient";

// With echo-message the server sends our private message back and that echo
// is the copy we show, so we only place one ourselves when nothing comes back.
export function showOwnPrivateMessage(
  serverId: string,
  chat: PrivateChat,
  user: User,
  content: string,
  replyMessage: Message | null,
) {
  if (ircClient.hasCapability(serverId, "echo-message")) return;
  useStore.getState().addMessage({
    id: uuidv4(),
    content,
    timestamp: new Date(),
    userId: user.username || user.id,
    channelId: chat.id,
    serverId,
    type: "message",
    reactions: [],
    replyMessage,
    mentioned: [],
  });
}
