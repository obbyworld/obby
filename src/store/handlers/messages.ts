import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { isUserIgnored } from "../../lib/ignoreUtils";
import ircClient from "../../lib/ircClient";
import { isChannelTarget } from "../../lib/ircUtils";
import {
  playNotificationSound,
  shouldPlayNotificationSound,
} from "../../lib/notificationSounds";
import {
  checkForMention,
  extractMentions,
  showMentionNotification,
} from "../../lib/notifications";
import type { Channel, Message, PrivateChat, User } from "../../types";
import {
  generateDeterministicId,
  getCurrentSelection,
  resolveReplyMessage,
  serverSupportsMetadata,
} from "../helpers";
import type { AppState } from "../index";
import { bufferChathistoryMessage, bufferChathistoryReaction } from "./batches";

export function registerMessageHandlers(store: StoreApi<AppState>): void {
  ircClient.on("CHANMSG", (response) => {
    const { mtags, channelName, message, timestamp } = response;

    // Check for duplicate messages based on msgid
    if (mtags?.msgid) {
      const currentState = store.getState();
      if (currentState.processedMessageIds.has(mtags.msgid)) {
        console.log(`Skipping duplicate message with msgid: ${mtags.msgid}`);
        return;
      }

      // Skip if this message is already part of a combined multiline message
      const server = currentState.servers.find(
        (s) => s.id === response.serverId,
      );
      const ch = server?.channels.find(
        (c) => c.name.toLowerCase() === channelName.toLowerCase(),
      );
      if (ch) {
        const channelKey = `${response.serverId}-${ch.id}`;
        const existing = currentState.messages[channelKey] || [];
        if (
          existing.some((m) => m.multilineMessageIds?.includes(mtags.msgid))
        ) {
          return;
        }
      }
    }

    // Check if sender is ignored
    const globalSettings = store.getState().globalSettings;
    if (
      isUserIgnored(
        response.sender,
        undefined,
        undefined,
        globalSettings.ignoreList,
      )
    ) {
      // User is ignored, skip processing this message
      return;
    }

    // Find the server and channel
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (server) {
      const channel = server.channels.find(
        (c) => c.name.toLowerCase() === channelName.toLowerCase(),
      );
      if (channel) {
        const channelKey = `${server.id}-${channel.id}`;
        const replyMessage = resolveReplyMessage(
          mtags,
          server.id,
          channel.id,
          store.getState().messages[channelKey] || [],
        );

        // Check for mentions and get current state
        const currentState = store.getState();
        const currentServerUser = ircClient.getCurrentUser(response.serverId);
        // Don't trigger mentions for our own messages
        const isOwnMessage =
          response.sender.toLowerCase() ===
          currentServerUser?.username?.toLowerCase();
        // Lazy-fetch the sender's metadata the first time they speak in
        // this session. metadataList() is idempotent + cached so the
        // cost is one METADATA LIST per unique speaker.
        if (!isOwnMessage && response.sender) {
          store.getState().metadataList(response.serverId, response.sender);
        }
        const isReplyToMe =
          !isOwnMessage &&
          !!replyMessage &&
          replyMessage.userId.toLowerCase() ===
            currentServerUser?.username?.toLowerCase();
        const hasMention =
          isReplyToMe ||
          (!isOwnMessage &&
            checkForMention(
              message,
              currentServerUser,
              currentState.globalSettings,
            ));
        const mentions = !isOwnMessage
          ? extractMentions(
              message,
              currentServerUser,
              currentState.globalSettings,
            )
          : [];

        const newMessage = {
          id: uuidv4(),
          msgid: mtags?.msgid,
          content: message,
          timestamp,
          userId: response.sender,
          channelId: channel.id,
          serverId: server.id,
          type: "message" as const,
          reactions: [],
          replyMessage: replyMessage,
          mentioned: mentions,
          tags: mtags,
        };

        // labeled-response: if this is the echo of a message we just
        // sent, the server MUST repeat the same label tag back.  Find
        // the local pending placeholder by label and update it in
        // place with the server's authoritative msgid + content.
        if (mtags?.label && isOwnMessage) {
          const matched = store
            .getState()
            .confirmPendingMessage(server.id, channel.id, mtags.label, {
              msgid: mtags.msgid,
              content: message,
              userId: response.sender,
              timestamp,
              tags: mtags,
            });
          if (matched) {
            // Track the msgid so subsequent duplicate-echo guards work.
            if (mtags.msgid) {
              store.setState((state) => ({
                processedMessageIds: new Set(state.processedMessageIds).add(
                  mtags.msgid as string,
                ),
              }));
            }
            return;
          }
        }

        // Update channel unread count and mention flag if not the active channel
        const isActiveChannel =
          getCurrentSelection(currentState).selectedChannelId === channel.id &&
          currentState.ui.selectedServerId === server.id;

        // Don't count unread/mentions for historical messages (batch tag indicates chathistory playback)
        const isHistoricalMessage = mtags?.batch !== undefined;

        if (isHistoricalMessage && mtags?.batch) {
          const batchId = mtags.batch;
          const batch =
            store.getState().activeBatches[response.serverId]?.[batchId];
          if (batch?.type === "chathistory") {
            bufferChathistoryMessage(batchId, newMessage);
            return;
          }
        }

        if (
          !isActiveChannel &&
          response.sender !== currentServerUser?.username &&
          !isHistoricalMessage
        ) {
          store.setState((state) => {
            const updatedServers = state.servers.map((s) => {
              if (s.id === server.id) {
                const updatedChannels = s.channels.map((ch) => {
                  if (ch.id === channel.id) {
                    return {
                      ...ch,
                      unreadCount: ch.unreadCount + 1,
                      mentionCount:
                        (ch.mentionCount ?? 0) + (hasMention ? 1 : 0),
                      isMentioned: hasMention || ch.isMentioned,
                    };
                  }
                  return ch;
                });
                return { ...s, channels: updatedChannels };
              }
              return s;
            });
            return { servers: updatedServers };
          });

          // Show browser notification for mentions
          if (hasMention && currentState.globalSettings.enableNotifications) {
            showMentionNotification(
              server.id,
              channelName,
              response.sender,
              message,
              (serverId, msg) => {
                // Fallback: Add a NOTE standard reply notification
                store.getState().addGlobalNotification({
                  type: "note",
                  command: "MENTION",
                  code: "HIGHLIGHT",
                  message: msg,
                  serverId,
                });
              },
            );
          }
        }

        // If message has bot tag, mark user as bot (skip for historical — live messages will set this)
        if (!isHistoricalMessage && mtags?.bot !== undefined) {
          store.setState((state) => {
            let hasChanges = false;
            const updatedServers = state.servers.map((s) => {
              if (s.id === server.id) {
                const updatedChannels = s.channels.map((channel) => {
                  const updatedUsers = channel.users.map((user) => {
                    if (user.username === response.sender && !user.isBot) {
                      hasChanges = true;
                      return {
                        ...user,
                        isBot: true,
                        metadata: {
                          ...user.metadata,
                          bot: { value: "true", visibility: "public" },
                        },
                      };
                    }
                    return user;
                  });
                  if (updatedUsers !== channel.users) {
                    return { ...channel, users: updatedUsers };
                  }
                  return channel;
                });
                if (updatedChannels !== s.channels) {
                  return { ...s, channels: updatedChannels };
                }
              }
              return s;
            });
            return hasChanges ? { servers: updatedServers } : {};
          });
        }

        // Combine message addition, message ID tracking, and typing user removal into single state update
        store.setState((state) => {
          const channelKey = `${newMessage.serverId}-${newMessage.channelId}`;
          const currentMessages = state.messages[channelKey] || [];

          // Check for duplicate messages
          const isDuplicate = currentMessages.some((existingMessage) => {
            return (
              existingMessage.id === newMessage.id ||
              (existingMessage.content === newMessage.content &&
                existingMessage.timestamp === newMessage.timestamp &&
                existingMessage.userId === newMessage.userId)
            );
          });

          if (isDuplicate) {
            return state;
          }

          // Add message and sort chronologically
          const updatedMessages = [...currentMessages, newMessage].sort(
            (a, b) => {
              const timeA =
                a.timestamp instanceof Date
                  ? a.timestamp.getTime()
                  : new Date(a.timestamp).getTime();
              const timeB =
                b.timestamp instanceof Date
                  ? b.timestamp.getTime()
                  : new Date(b.timestamp).getTime();
              return timeA - timeB;
            },
          );

          // Remove typing user
          const typingKey = `${server.id}-${channel.id}`;
          const currentTypingUsers = state.typingUsers[typingKey] || [];
          const updatedTypingUsers = currentTypingUsers.filter(
            (u) => u.username !== response.sender,
          );

          // Build combined state update
          const newState: Partial<AppState> = {
            messages: {
              ...state.messages,
              [channelKey]: updatedMessages,
            },
            typingUsers: {
              ...state.typingUsers,
              [typingKey]: updatedTypingUsers,
            },
          };

          // Add processed message ID if present
          if (mtags?.msgid) {
            newState.processedMessageIds = new Set([
              ...state.processedMessageIds,
              mtags.msgid,
            ]);
          }

          return newState;
        });

        // Play notification sound if appropriate (but not for historical messages)
        if (!isHistoricalMessage) {
          const state = store.getState();
          const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
          if (
            shouldPlayNotificationSound(
              newMessage,
              serverCurrentUser,
              state.globalSettings,
            )
          ) {
            playNotificationSound(state.globalSettings);
          }
        }
      }
    }
  });

  // Handle multiline messages
  ircClient.on("MULTILINE_MESSAGE", (response) => {
    const {
      mtags,
      channelName,
      target,
      sender,
      message,
      messageIds,
      timestamp,
    } = response;

    // Check for duplicate messages based on messageIds or batch msgid
    const currentState = store.getState();
    if (messageIds && messageIds.length > 0) {
      const hasDuplicate = messageIds.some((id) =>
        currentState.processedMessageIds.has(id),
      );
      if (hasDuplicate) {
        console.log(
          `Skipping duplicate multiline message with messageIds: ${messageIds.join(", ")}`,
        );
        return;
      }
    } else if (
      mtags?.msgid &&
      currentState.processedMessageIds.has(mtags.msgid)
    ) {
      console.log(
        `Skipping duplicate multiline message with batch msgid: ${mtags.msgid}`,
      );
      return;
    }

    // Check if sender is ignored
    const globalSettings = store.getState().globalSettings;
    if (
      isUserIgnored(sender, undefined, undefined, globalSettings.ignoreList)
    ) {
      // User is ignored, skip processing this message
      return;
    }

    // Find the server and channel
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (server) {
      const channel = channelName
        ? server.channels.find(
            (c) => c.name.toLowerCase() === channelName.toLowerCase(),
          )
        : null;

      if (channel) {
        const channelKey = `${server.id}-${channel.id}`;
        const replyMessage = resolveReplyMessage(
          mtags,
          server.id,
          channel.id,
          store.getState().messages[channelKey] || [],
        );

        const multilineCurrentState = store.getState();
        const multilineCurrentUser = ircClient.getCurrentUser(
          response.serverId,
        );
        const isOwnMessage =
          sender.toLowerCase() ===
          multilineCurrentUser?.username?.toLowerCase();
        const isReplyToMe =
          !isOwnMessage &&
          !!replyMessage &&
          replyMessage.userId.toLowerCase() ===
            multilineCurrentUser?.username?.toLowerCase();
        const hasMention =
          isReplyToMe ||
          (!isOwnMessage &&
            checkForMention(
              message,
              multilineCurrentUser,
              multilineCurrentState.globalSettings,
            ));
        const mentions = !isOwnMessage
          ? extractMentions(
              message,
              multilineCurrentUser,
              multilineCurrentState.globalSettings,
            )
          : [];

        const newMessage = {
          id: uuidv4(),
          msgid: mtags?.msgid,
          multilineMessageIds: messageIds,
          content: message,
          timestamp,
          userId: sender,
          channelId: channel.id,
          serverId: server.id,
          type: "message" as const,
          reactions: [],
          replyMessage: replyMessage,
          mentioned: mentions,
          tags: mtags,
        };

        // If message has bot tag, mark user as bot
        if (mtags?.bot !== undefined) {
          store.setState((state) => {
            const updatedServers = state.servers.map((s) => {
              if (s.id === server.id) {
                const updatedChannels = s.channels.map((channel) => {
                  const updatedUsers = channel.users.map((user) => {
                    if (user.username === sender) {
                      return {
                        ...user,
                        isBot: true,
                      };
                    }
                    return user;
                  });
                  return { ...channel, users: updatedUsers };
                });
                return { ...s, channels: updatedChannels };
              }
              return s;
            });
            return { servers: updatedServers };
          });
        }

        // Mark these message IDs as processed to prevent duplicates
        const idsToTrack =
          messageIds && messageIds.length > 0
            ? messageIds
            : mtags?.msgid
              ? [mtags.msgid]
              : [];
        if (idsToTrack.length > 0) {
          store.setState((state) => ({
            processedMessageIds: new Set([
              ...state.processedMessageIds,
              ...idsToTrack,
            ]),
          }));
        }

        store.getState().addMessage(newMessage);

        // Don't count unread/mentions for historical messages (batch tag indicates chathistory playback)
        const isHistoricalMessage = mtags?.batch !== undefined;
        const isActiveChannel =
          getCurrentSelection(multilineCurrentState).selectedChannelId ===
            channel.id &&
          multilineCurrentState.ui.selectedServerId === server.id;

        if (!isActiveChannel && !isOwnMessage && !isHistoricalMessage) {
          store.setState((state) => {
            const updatedServers = state.servers.map((s) => {
              if (s.id === server.id) {
                const updatedChannels = s.channels.map((ch) => {
                  if (ch.id === channel.id) {
                    return {
                      ...ch,
                      unreadCount: ch.unreadCount + 1,
                      mentionCount:
                        (ch.mentionCount ?? 0) + (hasMention ? 1 : 0),
                      isMentioned: hasMention || ch.isMentioned,
                    };
                  }
                  return ch;
                });
                return { ...s, channels: updatedChannels };
              }
              return s;
            });
            return { servers: updatedServers };
          });

          if (
            hasMention &&
            multilineCurrentState.globalSettings.enableNotifications
          ) {
            showMentionNotification(
              server.id,
              channelName ?? "",
              sender,
              message,
              (serverId, msg) => {
                store.getState().addGlobalNotification({
                  type: "note",
                  command: "MENTION",
                  code: "HIGHLIGHT",
                  message: msg,
                  serverId,
                });
              },
            );
          }
        }

        if (!isHistoricalMessage) {
          const state = store.getState();
          const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
          if (
            shouldPlayNotificationSound(
              newMessage,
              serverCurrentUser,
              state.globalSettings,
            )
          ) {
            playNotificationSound(state.globalSettings);
          }
        }

        // Remove any typing users from the state
        store.setState((state) => {
          const key = `${server.id}-${channel.id}`;
          const currentUsers = state.typingUsers[key] || [];
          return {
            typingUsers: {
              ...state.typingUsers,
              [key]: currentUsers.filter((u) => u.username !== sender),
            },
          };
        });
      } else if (!channelName) {
        const currentUser = ircClient.getCurrentUser(response.serverId);

        if (currentUser?.username.toLowerCase() === sender.toLowerCase()) {
          // Own message echo — store under DM keyed by `target`, same as USERMSG echo handler.
          if (!target) return;
          const privateChat = server.privateChats?.find(
            (pc) => pc.username.toLowerCase() === target.toLowerCase(),
          );
          if (privateChat) {
            // labeled-response: confirm the pending placeholder when
            // a matching label tag is on the BATCH-wrapped echo.
            if (mtags?.label) {
              const matched = store
                .getState()
                .confirmPendingMessage(server.id, privateChat.id, mtags.label, {
                  msgid: mtags.msgid,
                  multilineMessageIds: messageIds,
                  content: message,
                  userId: sender,
                  timestamp,
                  tags: mtags,
                });
              if (matched) {
                const idsToTrack =
                  messageIds?.length > 0
                    ? messageIds
                    : mtags?.msgid
                      ? [mtags.msgid]
                      : [];
                if (idsToTrack.length > 0) {
                  store.setState((state) => ({
                    processedMessageIds: new Set([
                      ...state.processedMessageIds,
                      ...idsToTrack,
                    ]),
                  }));
                }
                return;
              }
            }
            const privateChatKey = `${server.id}-${privateChat.id}`;
            const newMessage = {
              id: uuidv4(),
              msgid: mtags?.msgid,
              multilineMessageIds: messageIds,
              content: message,
              timestamp,
              userId: sender,
              channelId: privateChat.id,
              serverId: server.id,
              type: "message" as const,
              reactions: [],
              replyMessage: resolveReplyMessage(
                mtags,
                server.id,
                privateChat.id,
                store.getState().messages[privateChatKey] || [],
              ),
              mentioned: [],
              tags: mtags,
            };
            const idsToTrack =
              messageIds?.length > 0
                ? messageIds
                : mtags?.msgid
                  ? [mtags.msgid]
                  : [];
            if (idsToTrack.length > 0) {
              store.setState((state) => ({
                processedMessageIds: new Set([
                  ...state.processedMessageIds,
                  ...idsToTrack,
                ]),
              }));
            }
            store.getState().addMessage(newMessage);
          }
          return;
        }

        // Incoming DM from another user
        let privateChat = server.privateChats.find(
          (chat) => chat.username.toLowerCase() === sender.toLowerCase(),
        );
        if (!privateChat) {
          const newPrivateChat = {
            id: generateDeterministicId(server.id, sender),
            username: sender,
            serverId: server.id,
            unreadCount: 0,
            isMentioned: false,
            lastActivity: new Date(),
            isPinned: false,
            order: undefined,
            isOnline: false,
            isAway: false,
          };
          privateChat = newPrivateChat;
          store.setState((state) => ({
            servers: state.servers.map((s) =>
              s.id === server.id
                ? { ...s, privateChats: [...s.privateChats, newPrivateChat] }
                : s,
            ),
          }));
        }

        const privateChatKey = `${server.id}-${privateChat.id}`;
        const newMessage = {
          id: uuidv4(),
          msgid: mtags?.msgid,
          multilineMessageIds: messageIds,
          content: message,
          timestamp,
          userId: sender,
          channelId: privateChat.id,
          serverId: server.id,
          type: "message" as const,
          reactions: [],
          replyMessage: resolveReplyMessage(
            mtags,
            server.id,
            privateChat.id,
            store.getState().messages[privateChatKey] || [],
          ),
          mentioned: [],
          tags: mtags,
        };

        const idsToTrack =
          messageIds?.length > 0
            ? messageIds
            : mtags?.msgid
              ? [mtags.msgid]
              : [];
        if (idsToTrack.length > 0) {
          store.setState((state) => ({
            processedMessageIds: new Set([
              ...state.processedMessageIds,
              ...idsToTrack,
            ]),
          }));
        }

        store.getState().addMessage(newMessage);

        const isHistoricalMessage = mtags?.batch !== undefined;
        if (!isHistoricalMessage) {
          const state = store.getState();
          const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
          if (
            shouldPlayNotificationSound(
              newMessage,
              serverCurrentUser,
              state.globalSettings,
            )
          ) {
            playNotificationSound(state.globalSettings);
          }
        }
      }
    }
  });

  // Handle private messages (USERMSG)
  ircClient.on("USERMSG", (response) => {
    const { mtags, sender, target, message, timestamp } = response;

    // Check for duplicate messages based on msgid
    if (mtags?.msgid) {
      const currentState = store.getState();
      if (currentState.processedMessageIds.has(mtags.msgid)) {
        console.log(`Skipping duplicate USERMSG with msgid: ${mtags.msgid}`);
        return;
      }
    }

    // Find the server
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (server) {
      // Lazy-fetch sender metadata on first PM, same as CHANMSG path.
      // Skip server pseudo-sources (those have a "." in the source) and
      // our own echoes.
      const ourNick = ircClient
        .getCurrentUser(response.serverId)
        ?.username?.toLowerCase();
      if (sender && !sender.includes(".") && sender.toLowerCase() !== ourNick) {
        store.getState().metadataList(response.serverId, sender);
      }

      // Check if this PRIVMSG is from the server itself (sender contains a ".")
      // Server messages should go to Server Notices, not create PM tabs
      if (sender.includes(".")) {
        console.log(
          "[USERMSG] Server message detected, routing to Server Notices:",
          sender,
        );

        const targetChannelId = "server-notices";
        const newMessage: Message = {
          id: uuidv4(),
          type: "notice",
          content: message,
          timestamp: timestamp,
          userId: sender,
          channelId: targetChannelId,
          serverId: server.id,
          reactions: [],
          replyMessage: null,
          mentioned: [],
          tags: mtags,
        };

        store.getState().addMessage(newMessage);

        // Play notification sound if appropriate (but not for historical messages)
        const isHistoricalMessage = mtags?.batch !== undefined;
        if (!isHistoricalMessage) {
          const state = store.getState();
          const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
          if (
            shouldPlayNotificationSound(
              newMessage,
              serverCurrentUser,
              state.globalSettings,
            )
          ) {
            playNotificationSound(state.globalSettings);
          }
        }

        return; // Don't process as a regular PM
      }

      // Ignore check — must happen before whisper routing so ignored whispers are dropped too
      const globalSettingsForUsermsg = store.getState().globalSettings;
      if (
        isUserIgnored(
          sender,
          undefined,
          undefined,
          globalSettingsForUsermsg.ignoreList,
        )
      ) {
        return;
      }

      // Check if this is a whisper (has channel-context tag).
      // Prefer the ratified +channel-context; fall back to +draft/channel-context.
      const channelContext =
        mtags?.["+channel-context"] ?? mtags?.["+draft/channel-context"];

      if (channelContext) {
        const channel = server.channels.find(
          (c) => c.name.toLowerCase() === channelContext.toLowerCase(),
        );

        if (channel) {
          const channelKey = `${server.id}-${channel.id}`;
          const replyMessage = resolveReplyMessage(
            mtags,
            server.id,
            channel.id,
            store.getState().messages[channelKey] || [],
          );

          const newMessage = {
            id: uuidv4(),
            msgid: mtags?.msgid,
            content: message,
            timestamp,
            userId: sender,
            channelId: channel.id,
            serverId: server.id,
            type: "message" as const,
            reactions: [],
            replyMessage: replyMessage,
            mentioned: [],
            tags: mtags, // This includes the draft/channel-context tag
            whisperTarget: target, // Store the recipient for display
          };

          // Mark this message ID as processed to prevent duplicates
          if (mtags?.msgid) {
            store.setState((state) => ({
              processedMessageIds: new Set([
                ...state.processedMessageIds,
                mtags.msgid,
              ]),
            }));
          }

          store.getState().addMessage(newMessage);

          // Play notification sound if appropriate (only if it's not from ourselves and not historical)
          const currentUser = ircClient.getCurrentUser(response.serverId);
          const isHistoricalMessage = mtags?.batch !== undefined;

          if (currentUser?.username !== sender && !isHistoricalMessage) {
            const state = store.getState();
            const serverCurrentUser = ircClient.getCurrentUser(
              response.serverId,
            );
            if (
              shouldPlayNotificationSound(
                newMessage,
                serverCurrentUser,
                state.globalSettings,
              )
            ) {
              playNotificationSound(state.globalSettings);
            }
          }

          return; // Early return - don't create a private chat
        }
      }
    }

    const currentUser = ircClient.getCurrentUser(response.serverId);
    if (currentUser?.username === sender) {
      // Own message echo — store under the DM keyed by `target`, not `sender`.
      if (server && target) {
        const privateChat = server.privateChats?.find(
          (pc) => pc.username.toLowerCase() === target.toLowerCase(),
        );
        if (privateChat) {
          // labeled-response: replace the pending placeholder we
          // inserted on send instead of appending a new entry.
          if (mtags?.label) {
            const matched = store
              .getState()
              .confirmPendingMessage(server.id, privateChat.id, mtags.label, {
                msgid: mtags.msgid,
                content: message,
                userId: sender,
                timestamp,
                tags: mtags,
              });
            if (matched) {
              if (mtags.msgid) {
                store.setState((state) => ({
                  processedMessageIds: new Set(state.processedMessageIds).add(
                    mtags.msgid as string,
                  ),
                }));
              }
              return;
            }
          }

          const privateChatKey = `${server.id}-${privateChat.id}`;
          const newMessage = {
            id: uuidv4(),
            msgid: mtags?.msgid,
            content: message,
            timestamp,
            userId: sender,
            channelId: privateChat.id,
            serverId: server.id,
            type: "message" as const,
            reactions: [],
            replyMessage: resolveReplyMessage(
              mtags,
              server.id,
              privateChat.id,
              store.getState().messages[privateChatKey] || [],
            ),
            mentioned: [],
            tags: mtags,
          };
          store.getState().addMessage(newMessage);
        }
      }
      return;
    }

    if (server) {
      // Find or create private chat (IRC nicks are case-insensitive)
      let privateChat = server.privateChats?.find(
        (pc) => pc.username.toLowerCase() === sender.toLowerCase(),
      );

      if (!privateChat) {
        // Auto-create private chat when receiving a message
        store.getState().openPrivateChat(server.id, sender);
        // Get the newly created private chat
        privateChat = store
          .getState()
          .servers.find((s) => s.id === server.id)
          ?.privateChats?.find(
            (pc) => pc.username.toLowerCase() === sender.toLowerCase(),
          );
      }

      if (privateChat) {
        const privateChatKey = `${server.id}-${privateChat.id}`;
        const newMessage = {
          id: uuidv4(),
          msgid: mtags?.msgid,
          content: message,
          timestamp,
          userId: sender,
          channelId: privateChat.id,
          serverId: server.id,
          type: "message" as const,
          reactions: [],
          replyMessage: resolveReplyMessage(
            mtags,
            server.id,
            privateChat.id,
            store.getState().messages[privateChatKey] || [],
          ),
          mentioned: [],
          tags: mtags,
        };

        // If message has bot tag, mark user as bot
        if (mtags?.bot !== undefined) {
          store.setState((state) => {
            const updatedServers = state.servers.map((s) => {
              if (s.id === server.id) {
                const updatedChannels = s.channels.map((channel) => {
                  const updatedUsers = channel.users.map((user) => {
                    if (user.username === sender) {
                      return {
                        ...user,
                        isBot: true, // Set bot flag from message tags
                        metadata: {
                          ...user.metadata,
                          bot: { value: "true", visibility: "public" },
                        },
                      };
                    }
                    return user;
                  });
                  return { ...channel, users: updatedUsers };
                });
                return { ...s, channels: updatedChannels };
              }
              return s;
            });
            return { servers: updatedServers };
          });
        }

        // Mark this message ID as processed to prevent duplicates
        if (mtags?.msgid) {
          store.setState((state) => ({
            processedMessageIds: new Set([
              ...state.processedMessageIds,
              mtags.msgid,
            ]),
          }));
        }

        // If the stored username casing differs from the server-sent nick, correct it now.
        if (privateChat.username !== sender) {
          store.setState((state) => ({
            servers: state.servers.map((s) => {
              if (s.id !== server.id) return s;
              return {
                ...s,
                privateChats: s.privateChats?.map((pc) =>
                  pc.id === privateChat.id ? { ...pc, username: sender } : pc,
                ),
              };
            }),
          }));
        }

        store.getState().addMessage(newMessage);

        // Remove any typing users from the state
        store.setState((state) => {
          const key = `${server.id}-${privateChat.id}`;
          const currentUsers = state.typingUsers[key] || [];
          return {
            typingUsers: {
              ...state.typingUsers,
              [key]: currentUsers.filter((u) => u.username !== sender),
            },
          };
        });

        // Update private chat's last activity and unread count
        // Don't count unread/mentions for historical messages (batch tag indicates chathistory playback)
        const isHistoricalMessage = mtags?.batch !== undefined;

        // Play notification sound if appropriate (but not for historical messages)
        if (!isHistoricalMessage) {
          const state = store.getState();
          const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
          if (
            shouldPlayNotificationSound(
              newMessage,
              serverCurrentUser,
              state.globalSettings,
            )
          ) {
            playNotificationSound(state.globalSettings);
          }
        }

        store.setState((state) => {
          const updatedServers = state.servers.map((s) => {
            if (s.id === response.serverId) {
              const updatedPrivateChats =
                s.privateChats?.map((pc) => {
                  if (pc.id === privateChat.id) {
                    const isActive =
                      getCurrentSelection(state).selectedPrivateChatId ===
                      pc.id;
                    const reset = isActive || isHistoricalMessage;
                    return {
                      ...pc,
                      lastActivity: new Date(),
                      unreadCount: reset ? 0 : pc.unreadCount + 1,
                      mentionCount: reset ? 0 : (pc.mentionCount ?? 0) + 1,
                      isMentioned: !isHistoricalMessage && true, // All PMs are considered mentions (except historical)
                    };
                  }
                  return pc;
                }) || [];
              return { ...s, privateChats: updatedPrivateChats };
            }
            return s;
          });
          return { servers: updatedServers };
        });

        // Show browser notification for private messages
        const currentState = store.getState();
        const isActiveChat =
          getCurrentSelection(currentState).selectedPrivateChatId ===
          privateChat.id;
        if (
          !isActiveChat &&
          !isHistoricalMessage &&
          currentState.globalSettings.enableNotifications
        ) {
          showMentionNotification(
            server.id,
            `DM from ${sender}`,
            sender,
            message,
            (serverId, msg) => {
              // Fallback: Add a NOTE standard reply notification
              store.getState().addGlobalNotification({
                type: "note",
                command: "PRIVMSG",
                code: "DM",
                message: msg,
                serverId,
              });
            },
          );
        }
      }
    }
  });

  ircClient.on("CHANNNOTICE", (response) => {
    const { mtags, channelName, message, timestamp } = response;

    // Check for duplicate messages based on msgid
    if (mtags?.msgid) {
      const currentState = store.getState();
      if (currentState.processedMessageIds.has(mtags.msgid)) {
        console.log(
          `Skipping duplicate CHANNNOTICE with msgid: ${mtags.msgid}`,
        );
        return;
      }
    }

    // Check if sender is ignored
    const globalSettings = store.getState().globalSettings;
    if (
      isUserIgnored(
        response.sender,
        undefined,
        undefined,
        globalSettings.ignoreList,
      )
    ) {
      // User is ignored, skip processing this notice
      return;
    }

    // Find the server
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (!server) return;

    // Check if this is a JSON log notice
    const isJsonLog = mtags?.["unrealircd.org/json-log"];
    let jsonLogData = null;
    if (isJsonLog) {
      try {
        const jsonString = mtags["unrealircd.org/json-log"];
        // Log the raw JSON string for debugging (first 200 chars)
        console.log(
          "Raw JSON log data:",
          jsonString.substring(0, 200) + (jsonString.length > 200 ? "..." : ""),
        );
        jsonLogData = JSON.parse(jsonString);
      } catch (error) {
        console.error("Failed to parse JSON log:", error);
        console.error("Raw JSON string was:", mtags["unrealircd.org/json-log"]);
        // Try to clean up common issues
        try {
          const cleanedJson = mtags["unrealircd.org/json-log"]
            // Replace all \s with spaces (UnrealIRCd uses \s as non-standard space escape)
            .replace(/\\s/g, " ")
            // Handle other potential escape issues
            .replace(/\\'/g, "'")
            .replace(/\\&/g, "&");

          jsonLogData = JSON.parse(cleanedJson);
          console.log("Successfully parsed after cleanup");
        } catch (cleanupError) {
          console.error("Failed to parse even after cleanup:", cleanupError);
          // Try a more aggressive cleanup
          try {
            const aggressiveClean = mtags["unrealircd.org/json-log"]
              .replace(/\\s/g, " ") // Replace all \s with spaces
              .replace(/\\'/g, "'") // Replace \' with '
              .replace(/\\&/g, "&"); // Replace \& with &

            jsonLogData = JSON.parse(aggressiveClean);
            console.log("Successfully parsed with aggressive cleanup");
          } catch (aggressiveError) {
            console.error("Failed aggressive cleanup:", aggressiveError);
            // As a last resort, try to extract what we can
            try {
              // Look for JSON-like structure and extract key parts
              const jsonStr = mtags["unrealircd.org/json-log"];
              const extracted: Record<string, unknown> = {};
              // Try to extract common fields manually
              const timeMatch = jsonStr.match(/"timestamp":"([^"]+)"/);
              if (timeMatch) extracted.timestamp = timeMatch[1];
              const levelMatch = jsonStr.match(/"level":"([^"]+)"/);
              if (levelMatch) extracted.level = levelMatch[1];
              const msgMatch = jsonStr.match(/"msg":"([^"]+)"/);
              if (msgMatch) {
                // Clean the message
                extracted.msg = msgMatch[1].replace(/\\s/g, " ");
              }
              if (Object.keys(extracted).length > 0) {
                jsonLogData = extracted;
                console.log("Extracted partial data:", extracted);
              }
            } catch (extractError) {
              console.error("Failed to extract partial data:", extractError);
            }
          }
        }
      }
    }

    // Route all server notices to the server notices channel
    const targetChannelId = "server-notices";

    const newMessage: Message = {
      id: uuidv4(),
      type: isJsonLog ? "notice" : "notice", // Keep as notice type
      content: message,
      timestamp: timestamp,
      userId: response.sender,
      channelId: targetChannelId,
      serverId: server.id,
      reactions: [],
      replyMessage: null,
      mentioned: [],
      tags: mtags,
      jsonLogData, // Add parsed JSON log data
    };

    // Mark this message ID as processed to prevent duplicates
    if (mtags?.msgid) {
      store.setState((state) => ({
        processedMessageIds: new Set([
          ...state.processedMessageIds,
          mtags.msgid,
        ]),
      }));
    }

    store.getState().addMessage(newMessage);

    // Play notification sound if appropriate (but not for historical messages)
    // Don't count unread/mentions for historical messages (batch tag indicates chathistory playback)
    const isHistoricalMessage = mtags?.batch !== undefined;

    if (!isHistoricalMessage) {
      const state = store.getState();
      const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
      if (
        shouldPlayNotificationSound(
          newMessage,
          serverCurrentUser,
          state.globalSettings,
        )
      ) {
        playNotificationSound(state.globalSettings);
      }
    }
  });

  ircClient.on("USERNOTICE", (response) => {
    const { mtags, message, timestamp } = response;

    // Check for duplicate messages based on msgid
    if (mtags?.msgid) {
      const currentState = store.getState();
      if (currentState.processedMessageIds.has(mtags.msgid)) {
        console.log(`Skipping duplicate USERNOTICE with msgid: ${mtags.msgid}`);
        return;
      }
    }

    // Check if sender is ignored
    const globalSettings = store.getState().globalSettings;
    if (
      isUserIgnored(
        response.sender,
        undefined,
        undefined,
        globalSettings.ignoreList,
      )
    ) {
      // User is ignored, skip processing this notice
      return;
    }

    // Find the server
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (!server) return;

    // Check if this NOTICE is from the server itself (sender contains a ".")
    // Server notices should go to Server Notices, user notices should create PM tabs
    if (response.sender.includes(".")) {
      console.log(
        "[USERNOTICE] Server notice detected, routing to Server Notices:",
        response.sender,
      );

      // Check if this is a JSON log notice
      const isJsonLog = mtags?.["unrealircd.org/json-log"];
      let jsonLogData = null;
      if (isJsonLog) {
        try {
          const jsonString = mtags["unrealircd.org/json-log"];
          // Log the raw JSON string for debugging (first 200 chars)
          console.log(
            "Raw JSON log data:",
            jsonString.substring(0, 200) +
              (jsonString.length > 200 ? "..." : ""),
          );
          jsonLogData = JSON.parse(jsonString);
        } catch (error) {
          console.error("Failed to parse JSON log:", error);
          console.error(
            "Raw JSON string was:",
            mtags["unrealircd.org/json-log"],
          );
          // Try to clean up common issues
          try {
            const cleanedJson = mtags["unrealircd.org/json-log"]
              // Replace all \s with spaces (UnrealIRCd uses \s as non-standard space escape)
              .replace(/\\s/g, " ")
              // Handle other potential escape issues
              .replace(/\\'/g, "'")
              .replace(/\\&/g, "&");

            jsonLogData = JSON.parse(cleanedJson);
            console.log("Successfully parsed after cleanup");
          } catch (cleanupError) {
            console.error("Failed to parse even after cleanup:", cleanupError);
            // Try a more aggressive cleanup
            try {
              const aggressiveClean = mtags["unrealircd.org/json-log"]
                .replace(/\\s/g, " ") // Replace all \s with spaces
                .replace(/\\'/g, "'") // Replace \' with '
                .replace(/\\&/g, "&"); // Replace \& with &

              jsonLogData = JSON.parse(aggressiveClean);
              console.log("Successfully parsed with aggressive cleanup");
            } catch (aggressiveError) {
              console.error("Failed aggressive cleanup:", aggressiveError);
              // As a last resort, try to extract what we can
              try {
                // Look for JSON-like structure and extract key parts
                const jsonStr = mtags["unrealircd.org/json-log"];
                const extracted: Record<string, unknown> = {};
                // Try to extract common fields manually
                const timeMatch = jsonStr.match(/"timestamp":"([^"]+)"/);
                if (timeMatch) extracted.timestamp = timeMatch[1];
                const levelMatch = jsonStr.match(/"level":"([^"]+)"/);
                if (levelMatch) extracted.level = levelMatch[1];
                const msgMatch = jsonStr.match(/"msg":"([^"]+)"/);
                if (msgMatch) {
                  // Clean the message
                  extracted.msg = msgMatch[1].replace(/\\s/g, " ");
                }
                if (Object.keys(extracted).length > 0) {
                  jsonLogData = extracted;
                  console.log("Extracted partial data:", extracted);
                }
              } catch (extractError) {
                console.error("Failed to extract partial data:", extractError);
              }
            }
          }
        }
      }

      // Route server notices to the server notices channel
      const targetChannelId = "server-notices";

      const newMessage: Message = {
        id: uuidv4(),
        type: isJsonLog ? "notice" : "notice", // Keep as notice type
        content: message,
        timestamp: timestamp,
        userId: response.sender,
        channelId: targetChannelId,
        serverId: server.id,
        reactions: [],
        replyMessage: null,
        mentioned: [],
        tags: mtags,
        jsonLogData, // Add parsed JSON log data
      };

      // Mark this message ID as processed to prevent duplicates
      if (mtags?.msgid) {
        store.setState((state) => ({
          processedMessageIds: new Set([
            ...state.processedMessageIds,
            mtags.msgid,
          ]),
        }));
      }

      store.getState().addMessage(newMessage);

      // Play notification sound if appropriate (but not for historical messages)
      // Don't count unread/mentions for historical messages (batch tag indicates chathistory playback)
      const isHistoricalMessage = mtags?.batch !== undefined;

      if (!isHistoricalMessage) {
        const state = store.getState();
        const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
        if (
          shouldPlayNotificationSound(
            newMessage,
            serverCurrentUser,
            state.globalSettings,
          )
        ) {
          playNotificationSound(state.globalSettings);
        }
      }

      return; // Don't process as a user notice
    }

    // This is a user notice - treat it like a PM

    // Don't create private chats with ourselves
    const currentUser = ircClient.getCurrentUser(response.serverId);
    if (currentUser?.username === response.sender) {
      return;
    }

    // Find or create private chat (IRC nicks are case-insensitive)
    let privateChat = server.privateChats?.find(
      (pc) => pc.username.toLowerCase() === response.sender.toLowerCase(),
    );

    if (!privateChat) {
      // Auto-create private chat when receiving a notice
      store.getState().openPrivateChat(server.id, response.sender);
      // Get the newly created private chat
      privateChat = store
        .getState()
        .servers.find((s) => s.id === server.id)
        ?.privateChats?.find(
          (pc) => pc.username.toLowerCase() === response.sender.toLowerCase(),
        );
    }

    if (privateChat) {
      const newMessage: Message = {
        id: uuidv4(),
        msgid: mtags?.msgid,
        content: message,
        timestamp,
        userId: response.sender,
        channelId: privateChat.id, // Use private chat ID as channel ID
        serverId: server.id,
        type: "notice" as const, // Mark as notice type
        reactions: [],
        replyMessage: null,
        mentioned: [], // PMs don't have mentions in the traditional sense
        tags: mtags,
      };

      store.getState().addMessage(newMessage);

      // Update private chat's last activity and unread count
      const isHistoricalMessage = mtags?.batch !== undefined;

      // Play notification sound if appropriate (but not for historical messages)
      if (!isHistoricalMessage) {
        const state = store.getState();
        const serverCurrentUser = ircClient.getCurrentUser(response.serverId);
        if (
          shouldPlayNotificationSound(
            newMessage,
            serverCurrentUser,
            state.globalSettings,
          )
        ) {
          playNotificationSound(state.globalSettings);
        }
      }

      store.setState((state) => {
        const updatedServers = state.servers.map((s) => {
          if (s.id === response.serverId) {
            const updatedPrivateChats =
              s.privateChats?.map((pc) => {
                if (pc.id === privateChat.id) {
                  const isActive =
                    getCurrentSelection(state).selectedPrivateChatId === pc.id;
                  const reset = isActive || isHistoricalMessage;
                  return {
                    ...pc,
                    lastActivity: new Date(),
                    unreadCount: reset ? 0 : pc.unreadCount + 1,
                    mentionCount: reset ? 0 : (pc.mentionCount ?? 0) + 1,
                    isMentioned: !isHistoricalMessage && true, // All PMs are considered mentions (except historical)
                  };
                }
                return pc;
              }) || [];
            return { ...s, privateChats: updatedPrivateChats };
          }
          return s;
        });
        return { servers: updatedServers };
      });
    }
  });

  // CTCPs lol
  ircClient.on("CHANMSG", (response) => {
    const { channelName, message, timestamp } = response;

    // Find the server and channel
    const server = store
      .getState()
      .servers.find((s) => s.id === response.serverId);

    if (!server) return;

    const parv = message.split(" ");
    if (parv[0] === "\u0001VERSION\u0001") {
      ircClient.sendRaw(
        server.id,
        `NOTICE ${response.sender} :\u0001VERSION ObsidianIRC v${ircClient.version}\u0001`,
      );
    }
    if (parv[0] === "\u0001PING") {
      ircClient.sendRaw(
        server.id,
        `NOTICE ${response.sender} :\u0001PING ${parv[1]}\u0001`,
      );
    }
    if (parv[0] === "\u0001TIME\u0001") {
      const date = new Date();
      ircClient.sendRaw(
        server.id,
        `NOTICE ${response.sender} :\u0001TIME ${date.toUTCString()}\u0001`,
      );
    }
  });

  // TAGMSG typing
  ircClient.on("TAGMSG", (response) => {
    const { sender, mtags, channelName } = response;

    const globalSettingsForTagmsg = store.getState().globalSettings;
    if (
      isUserIgnored(
        sender,
        undefined,
        undefined,
        globalSettingsForTagmsg.ignoreList,
      )
    ) {
      return;
    }

    // Check if the sender is not the current user for this specific server
    // we don't care about showing our own typing status
    const currentUser = ircClient.getCurrentUser(response.serverId);
    if (sender !== currentUser?.username && mtags && mtags["+typing"]) {
      const isActive = mtags["+typing"] === "active";
      const server = store
        .getState()
        .servers.find((s) => s.id === response.serverId);

      if (!server) return;

      let key: string;
      let user: User;

      const isChannel = isChannelTarget(channelName);
      if (isChannel) {
        const channel = server.channels.find((c) => c.name === channelName);
        if (!channel) return;

        const foundUser = channel.users.find(
          (u) => u.username === response.sender,
        );
        if (!foundUser) return;
        user = foundUser;

        key = `${server.id}-${channel.id}`;
      } else {
        // Private chat
        const privateChat = server.privateChats?.find(
          (pc) => pc.username.toLowerCase() === sender.toLowerCase(),
        );
        if (!privateChat) return;

        // For private chats, create a user object
        user = {
          id: `${server.id}-${sender}`,
          username: sender,
          isOnline: true,
        };

        key = `${server.id}-${privateChat.id}`;
      }

      store.setState((state) => {
        const currentUsers = state.typingUsers[key] || [];
        const currentTimers = state.typingTimers[key] || {};

        if (isActive) {
          // Clear existing timer for this user if it exists
          if (currentTimers[user.username]) {
            clearTimeout(currentTimers[user.username]);
          }

          // Create a new timer to auto-clear typing notification after 6 seconds
          const timer = setTimeout(() => {
            store.setState((state) => {
              const currentUsers = state.typingUsers[key] || [];
              const currentTimers = state.typingTimers[key] || {};

              // Remove the timer reference
              const { [user.username]: removedTimer, ...remainingTimers } =
                currentTimers;

              return {
                typingUsers: {
                  ...state.typingUsers,
                  [key]: currentUsers.filter(
                    (u) => u.username !== user.username,
                  ),
                },
                typingTimers: {
                  ...state.typingTimers,
                  [key]: remainingTimers,
                },
              };
            });
          }, 6000);

          // Don't add if already in the list
          if (currentUsers.some((u) => u.username === user.username)) {
            // Update timer even if user is already in list
            return {
              typingTimers: {
                ...state.typingTimers,
                [key]: { ...currentTimers, [user.username]: timer },
              },
            };
          }

          return {
            typingUsers: {
              ...state.typingUsers,
              [key]: [...currentUsers, user],
            },
            typingTimers: {
              ...state.typingTimers,
              [key]: { ...currentTimers, [user.username]: timer },
            },
          };
        }
        // Remove the user from the list when they send "paused" or "done"
        // Clear their timer if it exists
        if (currentTimers[user.username]) {
          clearTimeout(currentTimers[user.username]);
        }

        const { [user.username]: removedTimer, ...remainingTimers } =
          currentTimers;

        return {
          typingUsers: {
            ...state.typingUsers,
            [key]: currentUsers.filter((u) => u.username !== user.username),
          },
          typingTimers: {
            ...state.typingTimers,
            [key]: remainingTimers,
          },
        };
      });
    }

    // Handle reactions
    const reactTargetId = mtags?.["+reply"] ?? mtags?.["+draft/reply"];
    if (mtags?.["+draft/react"] && reactTargetId) {
      // Chathistory batch: target message is in chathistoryBuffers, not the store yet.
      if (mtags.batch) {
        const batchId = mtags.batch;
        const batch =
          store.getState().activeBatches[response.serverId]?.[batchId];
        if (batch?.type === "chathistory") {
          bufferChathistoryReaction(batchId, {
            emoji: mtags["+draft/react"],
            userId: sender,
            targetMsgId: reactTargetId,
            isUnreact: false,
          });
          return;
        }
      }

      const emoji = mtags["+draft/react"];
      const replyMessageId = reactTargetId;

      const server = store
        .getState()
        .servers.find((s) => s.id === response.serverId);
      if (!server) return;

      let channel: Channel | PrivateChat | undefined;
      const isChannel = isChannelTarget(channelName);
      if (isChannel) {
        channel = server.channels.find((c) => c.name === channelName);
      } else {
        // channelName may be our own nick (incoming reaction echo), so also try sender
        channel = server.privateChats?.find(
          (pc) =>
            pc.username.toLowerCase() === channelName.toLowerCase() ||
            pc.username.toLowerCase() === sender.toLowerCase(),
        );
      }

      if (!channel) return;

      // Find the message to add reaction to
      const channelKey = `${server.id}-${channel.id}`;
      const messages = store.getState().messages[channelKey] || [];
      const messageIndex = messages.findIndex(
        (m) => m.msgid === replyMessageId,
      );
      if (messageIndex === -1) return;

      const message = messages[messageIndex];
      const existingReactionIndex = message.reactions.findIndex(
        (r) => r.emoji === emoji && r.userId === sender,
      );

      // Skip self-reactions that already exist — they're an echo of our optimistic update.
      // If the reaction doesn't exist yet (another session / history playback), add it.
      const currentUserForReaction = ircClient.getCurrentUser(
        response.serverId,
      );
      if (
        sender === currentUserForReaction?.username &&
        existingReactionIndex !== -1
      ) {
        return;
      }

      if (existingReactionIndex === -1) {
        store.setState((state) => {
          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: [...message.reactions, { emoji, userId: sender }],
          };
          const key = `${server.id}-${channel.id}`;
          return {
            messages: {
              ...state.messages,
              [key]: updatedMessages,
            },
          };
        });
      }
    }

    // Handle unreacts
    const unreactTargetId = mtags?.["+reply"] ?? mtags?.["+draft/reply"];
    if (mtags?.["+draft/unreact"] && unreactTargetId) {
      if (mtags.batch) {
        const batchId = mtags.batch;
        const batch =
          store.getState().activeBatches[response.serverId]?.[batchId];
        if (batch?.type === "chathistory") {
          bufferChathistoryReaction(batchId, {
            emoji: mtags["+draft/unreact"],
            userId: sender,
            targetMsgId: unreactTargetId,
            isUnreact: true,
          });
          return;
        }
      }

      const emoji = mtags["+draft/unreact"];
      const replyMessageId = unreactTargetId;
      // No self-skip needed: if the reaction was already removed optimistically,
      // existingReactionIndex will be -1 and the guard below is a no-op.

      const server = store
        .getState()
        .servers.find((s) => s.id === response.serverId);
      if (!server) return;

      let channel: Channel | PrivateChat | undefined;
      const isChannel = isChannelTarget(channelName);
      if (isChannel) {
        channel = server.channels.find((c) => c.name === channelName);
      } else {
        // channelName may be our own nick (incoming unreact echo), so also try sender
        channel = server.privateChats?.find(
          (pc) =>
            pc.username.toLowerCase() === channelName.toLowerCase() ||
            pc.username.toLowerCase() === sender.toLowerCase(),
        );
      }

      if (!channel) return;

      // Find the message to remove reaction from
      const channelKey = `${server.id}-${channel.id}`;
      const messages = store.getState().messages[channelKey] || [];
      const messageIndex = messages.findIndex(
        (m) => m.msgid === replyMessageId,
      );
      if (messageIndex === -1) return;

      const message = messages[messageIndex];
      const existingReactionIndex = message.reactions.findIndex(
        (r) => r.emoji === emoji && r.userId === sender,
      );

      // Only remove if the reaction exists
      if (existingReactionIndex !== -1) {
        store.setState((state) => {
          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: message.reactions.filter(
              (_, i) => i !== existingReactionIndex,
            ),
          };

          const key = `${server.id}-${channel.id}`;
          return {
            messages: {
              ...state.messages,
              [key]: updatedMessages,
            },
          };
        });
      }
    }

    // Handle link previews
    if (
      mtags &&
      (mtags["obsidianirc/link-preview-title"] ||
        mtags["obsidianirc/link-preview-snippet"] ||
        mtags["obsidianirc/link-preview-meta"]) &&
      mtags["+reply"]
    ) {
      const replyMessageId = mtags["+reply"];

      const server = store
        .getState()
        .servers.find((s) => s.id === response.serverId);
      if (!server) return;

      let channel: Channel | PrivateChat | undefined;
      const isChannel = isChannelTarget(channelName);
      if (isChannel) {
        channel = server.channels.find((c) => c.name === channelName);
      } else {
        // Private chat
        channel = server.privateChats?.find(
          (pc) => pc.username.toLowerCase() === channelName.toLowerCase(),
        );
      }

      if (!channel) return;

      // Find the message to add link preview to
      const channelKey = `${server.id}-${channel.id}`;
      const messages = store.getState().messages[channelKey] || [];
      const messageIndex = messages.findIndex(
        (m) => m.msgid === replyMessageId,
      );
      if (messageIndex === -1) return;

      const message = messages[messageIndex];

      // Helper function to unescape IRC tag values
      const unescapeTagValue = (
        value: string | undefined,
      ): string | undefined => {
        if (!value) return undefined;
        // IRC tag escaping: \: = ; \s = space \\ = \ \r = CR \n = LF
        return value
          .replace(/\\s/g, " ")
          .replace(/\\:/g, ";")
          .replace(/\\r/g, "\r")
          .replace(/\\n/g, "\n")
          .replace(/\\\\/g, "\\");
      };

      store.setState((state) => {
        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...message,
          linkPreviewTitle: unescapeTagValue(
            mtags["obsidianirc/link-preview-title"],
          ),
          linkPreviewSnippet: unescapeTagValue(
            mtags["obsidianirc/link-preview-snippet"],
          ),
          linkPreviewMeta: unescapeTagValue(
            mtags["obsidianirc/link-preview-meta"],
          ),
        };

        const key = `${server.id}-${channel.id}`;
        return {
          messages: {
            ...state.messages,
            [key]: updatedMessages,
          },
        };
      });
    }
  });

  ircClient.on("REDACT", ({ serverId, target, msgid, sender }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      let channel: Channel | PrivateChat | undefined;
      const isChannel = isChannelTarget(target);
      if (isChannel) {
        channel = server.channels.find((c) => c.name === target);
      } else {
        // Private chat
        channel = server.privateChats?.find(
          (pc) => pc.username.toLowerCase() === target.toLowerCase(),
        );
      }

      if (!channel) return {};

      // Find and replace the message with a system message
      const channelKey = `${server.id}-${channel.id}`;
      const messages = state.messages[channelKey] || [];
      const messageIndex = messages.findIndex((m) => m.msgid === msgid);
      if (messageIndex === -1) return {};

      const updatedMessages = [...messages];
      const originalMessage = updatedMessages[messageIndex];

      // Determine if the sender deleted their own message
      const isSender = originalMessage.userId === sender;
      const deletionMessage = isSender
        ? "This message has been deleted by the sender"
        : "This message has been deleted by a member of staff";

      // Replace the entire message with a system message
      updatedMessages[messageIndex] = {
        id: originalMessage.id,
        msgid: originalMessage.msgid,
        content: deletionMessage,
        timestamp: originalMessage.timestamp,
        userId: "system",
        channelId: originalMessage.channelId,
        serverId: originalMessage.serverId,
        type: "system",
        reactions: [],
        replyMessage: null,
        mentioned: [],
        tags: originalMessage.tags,
      };

      const key = `${server.id}-${channel.id}`;
      return {
        messages: {
          ...state.messages,
          [key]: updatedMessages,
        },
      };
    });
  });

  // Handle chathistory loading state
  ircClient.on(
    "CHATHISTORY_LOADING",
    ({ serverId, channelName, isLoading }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((channel) => {
              if (channel.name.toLowerCase() === channelName.toLowerCase()) {
                const updatedChannel = {
                  ...channel,
                  isLoadingHistory: isLoading,
                };

                // If loading just completed and we need to send WHO, do it now
                if (!isLoading && channel.needsWhoRequest) {
                  // Send WHO request now that CHATHISTORY is done
                  ircClient.sendRaw(serverId, `WHO ${channelName} %cuhnfaro`);

                  // Request channel metadata if server supports it
                  if (serverSupportsMetadata(state, serverId)) {
                    ircClient.metadataGet(serverId, channelName, [
                      "avatar",
                      "display-name",
                    ]);
                  }

                  // Clear the flag
                  updatedChannel.needsWhoRequest = false;
                }

                return updatedChannel;
              }
              return channel;
            });
            return { ...server, channels: updatedChannels };
          }
          return server;
        });
        return { servers: updatedServers };
      });
    },
  );
}
