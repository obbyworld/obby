import { t } from "@lingui/core/macro";
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { Message } from "../../types";
import { type BatchInfo, MAX_MESSAGES_PER_CHANNEL } from "../helpers";
import { type AppState, rememberMsgIds } from "../index";

// Chathistory messages are buffered here (outside the store) to avoid one
// store.setState per incoming PRIVMSG.  Only flushed at BATCH_END.
export const chathistoryBuffers = new Map<string, Message[]>();

export function bufferChathistoryMessage(batchId: string, msg: Message): void {
  let buf = chathistoryBuffers.get(batchId);
  if (!buf) {
    buf = [];
    chathistoryBuffers.set(batchId, buf);
  }
  buf.push(msg);
}

interface BufferedReaction {
  emoji: string;
  userId: string;
  targetMsgId: string;
  isUnreact: boolean;
}

// Reactions that arrive via TAGMSG during a chathistory batch are buffered here.
// The target message is still in chathistoryBuffers at that point, not in the store.
export const reactionBuffers = new Map<string, BufferedReaction[]>();

export function bufferChathistoryReaction(
  batchId: string,
  r: BufferedReaction,
): void {
  let buf = reactionBuffers.get(batchId);
  if (!buf) {
    buf = [];
    reactionBuffers.set(batchId, buf);
  }
  buf.push(r);
}

function processBatchedNetsplit(
  store: StoreApi<AppState>,
  serverId: string,
  batchId: string,
  batch: BatchInfo,
) {
  const storeState = store.getState();
  const batch_info = storeState.activeBatches[serverId]?.[batchId];
  if (!batch_info) return;

  const quitEvents = batch_info.events;
  const [server1, server2] = batch_info.parameters || ["*.net", "*.split"];

  // Create a single netsplit message
  const netsplitMessage = {
    id: `netsplit-${batchId}`,
    content: t`Oops! The net split! ⚠️`,
    timestamp: new Date(),
    userId: "system",
    channelId: "", // Will be set per channel
    serverId,
    type: "netsplit" as const,
    batchId,
    quitUsers: quitEvents.map((e) => e.data.username),
    server1,
    server2,
    reactions: [],
    replyMessage: null,
    mentioned: [],
  };

  // Group affected channels and add the netsplit message to each
  const affectedChannels = new Set<string>();

  // Process each quit event to remove users and track affected channels
  quitEvents.forEach((event) => {
    const { username } = event.data;

    // Find which channels this user was in and remove them
    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            const userIndex = channel.users.findIndex(
              (u) => u.username === username,
            );
            if (userIndex !== -1) {
              affectedChannels.add(channel.id);
              // Remove the user from the channel
              const updatedUsers = channel.users.filter(
                (u) => u.username !== username,
              );
              return { ...channel, users: updatedUsers };
            }
            return channel;
          });
          return { ...server, channels: updatedChannels };
        }
        return server;
      });
      return { servers: updatedServers };
    });
  });

  // Add netsplit message to each affected channel
  affectedChannels.forEach((channelId) => {
    const channelMessage = { ...netsplitMessage, channelId };
    store.getState().addMessage(channelMessage);
  });
}

function processBatchedNetjoin(
  store: StoreApi<AppState>,
  serverId: string,
  batchId: string,
  batch: BatchInfo,
) {
  const storeState = store.getState();
  const batch_info = storeState.activeBatches[serverId]?.[batchId];
  if (!batch_info) return;

  const joinEvents = batch_info.events;
  const [server1, server2] = batch_info.parameters || ["*.net", "*.join"];

  // Process each join event normally first
  joinEvents.forEach((event) => {
    // Re-trigger the JOIN event to add users back
    if (event.type === "JOIN") {
      ircClient.triggerEvent("JOIN", event.data);
    }
  });

  // Find and update any existing netsplit messages to show rejoin
  store.setState((state) => {
    const updatedMessages = { ...state.messages };

    Object.keys(updatedMessages).forEach((channelKey) => {
      const messages = updatedMessages[channelKey];
      const updatedChannelMessages = messages.map((message) => {
        if (
          message.type === "netsplit" &&
          message.serverId === serverId &&
          message.server1 === server1 &&
          message.server2 === server2
        ) {
          // Update the netsplit message to show rejoin
          return {
            ...message,
            content: t`The network split and rejoined. ✅`,
            type: "netjoin" as const,
          };
        }
        return message;
      });
      updatedMessages[channelKey] = updatedChannelMessages;
    });

    return { messages: updatedMessages };
  });
}

export function registerBatchHandlers(store: StoreApi<AppState>): void {
  ircClient.on("BATCH_START", ({ serverId, batchId, type }) => {
    const state = store.getState();

    if (!state.metadataBatches[batchId]) {
      store.setState((state) => ({
        metadataBatches: {
          ...state.metadataBatches,
          [batchId]: { type, messages: [] },
        },
      }));
    }
  });

  ircClient.on("BATCH_END", ({ serverId, batchId }) => {
    // End a batch - process all messages in the batch
    store.setState((state) => {
      const batch = state.metadataBatches[batchId];
      if (batch) {
        // Process batch messages (they should have been collected during the batch)
        // For metadata batches, the individual METADATA_KEYVALUE events should have updated the state
      }
      const { [batchId]: _, ...remainingBatches } = state.metadataBatches;
      return {
        metadataBatches: remainingBatches,
      };
    });
  });

  ircClient.on("BATCH_START", ({ serverId, batchId, type, parameters }) => {
    store.setState((state) => {
      const serverBatches = state.activeBatches[serverId] || {};
      return {
        activeBatches: {
          ...state.activeBatches,
          [serverId]: {
            ...serverBatches,
            [batchId]: {
              type,
              parameters: parameters || [],
              events: [],
              startTime: new Date(),
            },
          },
        },
      };
    });
  });

  ircClient.on("BATCH_END", ({ serverId, batchId }) => {
    // Capture chathistory channel name so we can fire the loading event AFTER setState.
    // Calling triggerEvent inside store.setState causes a nested setState race: the inner
    // call sets isLoadingHistory=false, but the outer callback then returns stale servers
    // state (isLoadingHistory still true), overwriting the inner change.
    let chathistoryChannelName: string | null = null;

    store.setState((state) => {
      const serverBatches = state.activeBatches[serverId];
      if (!serverBatches?.[batchId]) {
        return state;
      }

      const batch = serverBatches[batchId];

      // Process the batch based on its type
      if (batch.type === "netsplit") {
        processBatchedNetsplit(store, serverId, batchId, batch);
      } else if (batch.type === "netjoin") {
        processBatchedNetjoin(store, serverId, batchId, batch);
      } else if (
        batch.type === "draft/multiline" ||
        batch.type === "multiline"
      ) {
        // Multiline batches are handled by the IRC client directly via MULTILINE_MESSAGE events
        // Don't process individual events here, the IRC client already combined them
      } else if (batch.type === "metadata") {
        // Metadata batches are handled by the IRC client directly via individual METADATA events
        // Don't process individual events here, metadata updates are already processed
      } else if (batch.type === "chathistory") {
        const channelName =
          batch.parameters && batch.parameters.length > 0
            ? batch.parameters[0]
            : null;
        if (channelName) {
          chathistoryChannelName = channelName;
        }
      } else {
        // For unknown batch types, process events individually
        batch.events.forEach((event) => {
          // Re-trigger the event without batch context based on its type
          switch (event.type) {
            case "JOIN":
              ircClient.triggerEvent("JOIN", event.data);
              break;
            case "QUIT":
              ircClient.triggerEvent("QUIT", event.data);
              break;
            case "PART":
              ircClient.triggerEvent("PART", event.data);
              break;
          }
        });
      }

      // Remove the completed batch
      const { [batchId]: removed, ...remainingBatches } = serverBatches;

      if (batch.type === "chathistory" && batch.parameters?.[0]) {
        const channelName = batch.parameters[0];
        const server = state.servers.find((s) => s.id === serverId);
        const channel = server?.channels.find(
          (c) => c.name.toLowerCase() === channelName.toLowerCase(),
        );
        if (channel) {
          const key = `${serverId}-${channel.id}`;
          const pending = chathistoryBuffers.get(batchId) ?? [];
          chathistoryBuffers.delete(batchId);
          const existing = state.messages[key] || [];

          // Dedup buffered messages against what's already in the store (event messages
          // like JOIN/PART arrive immediately and will already be in existing).
          const existingIds = new Set(
            existing.map((m) => m.msgid).filter(Boolean),
          );
          const newMessages = pending.filter(
            (m) =>
              !(m.msgid && existingIds.has(m.msgid)) &&
              !existing.some(
                (e) =>
                  e.content === m.content &&
                  new Date(e.timestamp).getTime() ===
                    new Date(m.timestamp).getTime() &&
                  e.userId === m.userId,
              ),
          );

          const merged = [...existing, ...newMessages]
            .sort(
              (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime(),
            )
            .slice(-MAX_MESSAGES_PER_CHANNEL);

          // Apply buffered reactions and re-resolve reply references now that
          // all messages from the batch are in `merged` and visible to each other.
          const pendingReactions = reactionBuffers.get(batchId) ?? [];
          reactionBuffers.delete(batchId);

          const finalMessages = merged.map((m) => {
            let updated = m;

            // Re-resolve reply if it was null when the message was buffered
            // (the reply target may have been later in the same batch).
            if (
              !updated.replyMessage &&
              (updated.tags?.["+reply"] || updated.tags?.["+draft/reply"])
            ) {
              const replyId = (updated.tags["+reply"] ??
                updated.tags["+draft/reply"]) as string;
              const found = merged.find(
                (r) =>
                  r.msgid === replyId ||
                  r.multilineMessageIds?.includes(replyId),
              );
              if (found) updated = { ...updated, replyMessage: found };
            }

            // Apply any reactions/unreactions buffered for this message.
            const relevant = pendingReactions.filter(
              (r) => r.targetMsgId === m.msgid,
            );
            if (relevant.length === 0) return updated;

            let reactions = [...updated.reactions];
            for (const r of relevant) {
              if (r.isUnreact) {
                reactions = reactions.filter(
                  (e) => !(e.emoji === r.emoji && e.userId === r.userId),
                );
              } else if (
                !reactions.some(
                  (e) => e.emoji === r.emoji && e.userId === r.userId,
                )
              ) {
                reactions.push({ emoji: r.emoji, userId: r.userId });
              }
            }
            return { ...updated, reactions };
          });

          const newMsgIds = newMessages
            .filter((m) => m.msgid)
            .map((m) => m.msgid as string);

          return {
            activeBatches: {
              ...state.activeBatches,
              [serverId]: remainingBatches,
            },
            messages: { ...state.messages, [key]: finalMessages },
            processedMessageIds: rememberMsgIds(
              state.processedMessageIds,
              newMsgIds,
            ),
            servers: state.servers.map((s) => {
              if (s.id !== serverId) return s;
              return {
                ...s,
                channels: s.channels.map((ch) => {
                  if (ch.id !== channel.id) return ch;
                  return {
                    ...ch,
                    hasMoreHistory: pending.length > 0,
                    isLoadingHistory: false,
                  };
                }),
              };
            }),
          };
        }

        // Chathistory target is a username (private chat / DM)
        const privateChat = server?.privateChats?.find(
          (pc) => pc.username.toLowerCase() === channelName.toLowerCase(),
        );
        if (privateChat) {
          const key = `${serverId}-${privateChat.id}`;
          const pending = chathistoryBuffers.get(batchId) ?? [];
          chathistoryBuffers.delete(batchId);
          const pendingReactions = reactionBuffers.get(batchId) ?? [];
          reactionBuffers.delete(batchId);
          const existing = state.messages[key] || [];

          const existingIds = new Set(
            existing.map((m) => m.msgid).filter(Boolean),
          );
          const newMessages = pending.filter(
            (m) =>
              !(m.msgid && existingIds.has(m.msgid)) &&
              !existing.some(
                (e) =>
                  e.content === m.content &&
                  new Date(e.timestamp).getTime() ===
                    new Date(m.timestamp).getTime() &&
                  e.userId === m.userId,
              ),
          );

          const merged = [...existing, ...newMessages]
            .sort(
              (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime(),
            )
            .slice(-MAX_MESSAGES_PER_CHANNEL);

          const finalMessages = merged.map((m) => {
            let updated = m;
            if (
              !updated.replyMessage &&
              (updated.tags?.["+reply"] || updated.tags?.["+draft/reply"])
            ) {
              const replyId = (updated.tags["+reply"] ??
                updated.tags["+draft/reply"]) as string;
              const found = merged.find(
                (r) =>
                  r.msgid === replyId ||
                  r.multilineMessageIds?.includes(replyId),
              );
              if (found) updated = { ...updated, replyMessage: found };
            }
            const relevant = pendingReactions.filter(
              (r) => r.targetMsgId === m.msgid,
            );
            if (relevant.length === 0) return updated;
            let reactions = [...updated.reactions];
            for (const r of relevant) {
              if (r.isUnreact) {
                reactions = reactions.filter(
                  (e) => !(e.emoji === r.emoji && e.userId === r.userId),
                );
              } else if (
                !reactions.some(
                  (e) => e.emoji === r.emoji && e.userId === r.userId,
                )
              ) {
                reactions.push({ emoji: r.emoji, userId: r.userId });
              }
            }
            return { ...updated, reactions };
          });

          const newMsgIds = newMessages
            .filter((m) => m.msgid)
            .map((m) => m.msgid as string);

          return {
            activeBatches: {
              ...state.activeBatches,
              [serverId]: remainingBatches,
            },
            messages: { ...state.messages, [key]: finalMessages },
            processedMessageIds: rememberMsgIds(
              state.processedMessageIds,
              newMsgIds,
            ),
          };
        }

        // Unknown target — still clean up buffers to prevent dangling data
        chathistoryBuffers.delete(batchId);
        reactionBuffers.delete(batchId);
      }

      return {
        activeBatches: {
          ...state.activeBatches,
          [serverId]: remainingBatches,
        },
      };
    });

    // Fire after setState so the WHO/metadata side effects run on correct state.
    // isLoadingHistory is already false from the setState above.
    if (chathistoryChannelName) {
      ircClient.triggerEvent("CHATHISTORY_LOADING", {
        serverId,
        channelName: chathistoryChannelName,
        isLoading: false,
      });
    }
  });
}
