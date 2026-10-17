/**
 * Hook for managing message reactions and reaction modal
 */
import { useCallback, useRef, useState } from "react";
import ircClient from "../lib/ircClient";
import useStore from "../store";
import {
  updateMessageByMsgid,
  withoutReaction,
  withReaction,
} from "../store/helpers";
import type { Message, Server, User } from "../types";

const messageKey = (message: Message) =>
  `${message.serverId}-${message.channelId}`;

interface ReactionModalState {
  isOpen: boolean;
  message: Message | null;
}

interface UseReactionsOptions {
  selectedServerId: string | null;
  currentUser: User | null;
}

interface UseReactionsReturn {
  reactionModal: ReactionModalState;
  openReactionModal: (message: Message) => void;
  closeReactionModal: () => void;
  selectReaction: (emoji: string) => void;
  directReaction: (emoji: string, message: Message) => void;
  unreact: (emoji: string, message: Message) => void;
}

/**
 * Manages message reactions and reaction modal state
 */
export function useReactions({
  selectedServerId,
  currentUser,
}: UseReactionsOptions): UseReactionsReturn {
  const set = useStore.setState;
  // We read the user through a ref so the callbacks keep one identity and
  // every memoized message row does not re-render when the user object changes.
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const [reactionModal, setReactionModal] = useState<ReactionModalState>({
    isOpen: false,
    message: null,
  });

  /**
   * Open reaction modal for a message
   */
  const openReactionModal = useCallback((message: Message) => {
    setReactionModal({
      isOpen: true,
      message,
    });
  }, []);

  /**
   * Close reaction modal
   */
  const closeReactionModal = useCallback(() => {
    setReactionModal({
      isOpen: false,
      message: null,
    });
  }, []);

  /**
   * Find server and target for a message (channel name or username for private)
   */
  const findServerAndTarget = useCallback(
    (
      message: Message,
    ): { server: Server | undefined; target: string | undefined } => {
      const server = useStore
        .getState()
        .servers.find((s) => s.id === message.serverId);
      if (!server) return { server: undefined, target: undefined };

      const channel = server.channels.find((c) => c.id === message.channelId);
      if (channel) return { server, target: channel.name };

      const privateChat = server.privateChats?.find(
        (pc) => pc.id === message.channelId,
      );
      return { server, target: privateChat?.username };
    },
    [],
  );

  /**
   * Select reaction from modal (toggle if already reacted)
   */
  const selectReaction = useCallback(
    (emoji: string) => {
      if (!reactionModal.message?.msgid) {
        closeReactionModal();
        return;
      }

      const { server, target } = findServerAndTarget(reactionModal.message);

      if (server && target) {
        // Check live store state — reactionModal.message is stale after optimistic updates
        const storeMsg = (() => {
          const key = `${reactionModal.message.serverId}-${reactionModal.message.channelId}`;
          return useStore
            .getState()
            .messages[key]?.find((m) => m.id === reactionModal.message?.id);
        })();
        const liveReactions =
          storeMsg?.reactions ?? reactionModal.message.reactions;
        const existingReaction = liveReactions.find(
          (r) => r.emoji === emoji && r.userId === currentUser?.username,
        );

        if (existingReaction) {
          // Send unreact message
          const tagMsg = `@+draft/unreact=${emoji};+reply=${reactionModal.message.msgid};+draft/reply=${reactionModal.message.msgid} TAGMSG ${target}`;
          ircClient.sendRaw(server.id, tagMsg);
        } else {
          // Send react message
          const tagMsg = `@+draft/react=${emoji};+reply=${reactionModal.message.msgid};+draft/reply=${reactionModal.message.msgid} TAGMSG ${target}`;
          ircClient.sendRaw(server.id, tagMsg);
        }

        const message = reactionModal.message;
        const { msgid } = message;
        const userId = currentUser?.username ?? "";
        const toggle = existingReaction ? withoutReaction : withReaction;
        if (msgid)
          set((state) =>
            updateMessageByMsgid(state, messageKey(message), msgid, (m) =>
              toggle(m, emoji, userId),
            ),
          );
      }
    },
    [
      reactionModal.message,
      currentUser,
      findServerAndTarget,
      closeReactionModal,
    ],
  );

  /**
   * Add a direct reaction to a message (without modal)
   */
  const directReaction = useCallback(
    (emoji: string, message: Message) => {
      const { msgid } = message;
      if (!msgid || !selectedServerId) return;

      const { server, target } = findServerAndTarget(message);

      if (server && target) {
        const tagMsg = `@+draft/react=${emoji};+reply=${message.msgid};+draft/reply=${message.msgid} TAGMSG ${target}`;
        ircClient.sendRaw(server.id, tagMsg);

        set((state) =>
          updateMessageByMsgid(state, messageKey(message), msgid, (m) =>
            withReaction(m, emoji, currentUserRef.current?.username ?? ""),
          ),
        );
      }
    },
    [selectedServerId, findServerAndTarget],
  );

  /**
   * Remove a reaction from a message
   */
  const unreact = useCallback(
    (emoji: string, message: Message) => {
      const { msgid } = message;
      if (!msgid || !selectedServerId) return;

      const { server, target } = findServerAndTarget(message);

      if (server && target) {
        const tagMsg = `@+draft/unreact=${emoji};+reply=${message.msgid};+draft/reply=${message.msgid} TAGMSG ${target}`;
        ircClient.sendRaw(server.id, tagMsg);

        set((state) =>
          updateMessageByMsgid(state, messageKey(message), msgid, (m) =>
            withoutReaction(m, emoji, currentUserRef.current?.username ?? ""),
          ),
        );
      }
    },
    [selectedServerId, findServerAndTarget],
  );

  return {
    reactionModal,
    openReactionModal,
    closeReactionModal,
    selectReaction,
    directReaction,
    unreact,
  };
}
