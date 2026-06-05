import { t } from "@lingui/core/macro";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { Message, User } from "../../types";
import {
  generateDeterministicId,
  getCurrentSelection,
  resolveUserMetadata,
} from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";

function appendMessage(
  store: StoreApi<AppState>,
  serverId: string,
  channelId: string,
  message: Message,
): void {
  const key = `${serverId}-${channelId}`;
  store.setState((s) => ({
    messages: { ...s.messages, [key]: [...(s.messages[key] || []), message] },
  }));
}

function makeEventMessage(
  type: Message["type"],
  content: string,
  userId: string,
  channelId: string,
  serverId: string,
  timestamp: Date,
  fromHistory?: boolean,
): Message {
  return {
    id: uuidv4(),
    type,
    content,
    timestamp,
    userId,
    channelId,
    serverId,
    reactions: [],
    replyMessage: null,
    mentioned: [],
    fromHistory,
  };
}

export function registerUserHandlers(store: StoreApi<AppState>): void {
  ircClient.on(
    "JOIN",
    ({
      serverId,
      username,
      channelName,
      batchTag,
      time,
      account,
      realname,
    }) => {
      if (batchTag) {
        const state = store.getState();
        const batch = state.activeBatches[serverId]?.[batchTag];
        if (batch) {
          if (batch.type === "chathistory") {
            // Historical join from event-playback — create a message record, skip live mutation.
            // Use the channel scoped by the batch, not all channels.
            const batchChannelName = batch.parameters?.[0];
            const ourNick = ircClient.getNick(serverId);
            if (
              batchChannelName &&
              username !== ourNick &&
              state.globalSettings.showEvents &&
              state.globalSettings.showJoinsParts
            ) {
              const server = state.servers.find((s) => s.id === serverId);
              const channel = server?.channels.find(
                (c) => c.name.toLowerCase() === batchChannelName.toLowerCase(),
              );
              if (channel) {
                appendMessage(
                  store,
                  serverId,
                  channel.id,
                  makeEventMessage(
                    "join",
                    t`joined ${channelName}`,
                    username,
                    channel.id,
                    serverId,
                    time ? new Date(time) : new Date(),
                    true,
                  ),
                );
              }
            }
            return;
          }
          // Netsplit/netjoin batch — defer to batch handler
          batch.events.push({
            type: "JOIN",
            data: { serverId, username, channelName, account, realname },
          });
          return;
        }
      }

      const ourNick = ircClient.getNick(serverId);
      const isOurJoin = username === ourNick;

      if (isOurJoin) {
        // Server-initiated JOIN (Unreal persistence, sajoin, perform list,
        // perform-on-connect): joinChannel() never ran, so the CHATHISTORY
        // + WHO chain that normally lives inside it was never kicked off.
        // Mirror joinChannel's tail here for the channel-doesn't-exist case
        // so the nicklist actually populates. Don't add ourselves to the
        // member list — NAMES populates it with proper modes.
        let newChannelHadCap: boolean | null = null;
        store.setState((state) => {
          const server = state.servers.find((s) => s.id === serverId);
          if (!server) return {};

          const exists = server.channels.some(
            (c) => c.name.toLowerCase() === channelName.toLowerCase(),
          );
          if (exists) return {};

          const hasChathistory =
            !!server.capabilities?.includes("draft/chathistory");
          newChannelHadCap = hasChathistory;

          return {
            servers: state.servers.map((s) => {
              if (s.id !== serverId) return s;
              return {
                ...s,
                channels: [
                  ...s.channels,
                  {
                    id: generateDeterministicId(serverId, channelName),
                    name: channelName,
                    isPrivate: false,
                    serverId,
                    unreadCount: 0,
                    isMentioned: false,
                    messages: [],
                    users: [],
                    isLoadingHistory: hasChathistory,
                    hasMoreHistory: hasChathistory,
                    needsWhoRequest: !!hasChathistory,
                    chathistoryRequested: hasChathistory,
                  },
                ],
              };
            }),
          };
        });
        // ircClient I/O OUTSIDE setState: triggerEvent inside setState
        // causes a nested-setState race (see batches.ts:215-218).
        if (newChannelHadCap === true) {
          ircClient.sendRaw(serverId, `CHATHISTORY LATEST ${channelName} * 50`);
          ircClient.triggerEvent("CHATHISTORY_LOADING", {
            serverId,
            channelName,
            isLoading: true,
          });
        } else if (newChannelHadCap === false) {
          ircClient.sendRaw(serverId, `WHO ${channelName} %cuhnfaro`);
        }
        // Fall through to shared message creation below — same JOIN event, same path.
      } else {
        store.setState((state) => {
          const updatedServers = state.servers.map((server) => {
            if (server.id !== serverId) return server;

            // Restore metadata so live joins show avatars immediately.
            const savedMetadata = storage.metadata.load();
            const serverMetadata = savedMetadata[serverId];
            const joinedUserMetadata = resolveUserMetadata(
              username,
              serverMetadata,
              server.channels,
            );

            const updatedChannels = server.channels.map((channel) => {
              if (channel.name.toLowerCase() !== channelName.toLowerCase())
                return channel;

              const alreadyIn = channel.users.some(
                (u) => u.username.toLowerCase() === username.toLowerCase(),
              );
              if (alreadyIn) return channel;

              const newUser: User = {
                id: uuidv4(),
                username,
                isOnline: true,
                account: account || undefined,
                realname: realname || undefined,
                metadata: joinedUserMetadata,
              };

              return { ...channel, users: [...channel.users, newUser] };
            });

            return { ...server, channels: updatedChannels };
          });

          return { servers: updatedServers };
        });
      }

      const state = store.getState();
      if (
        state.globalSettings.showEvents &&
        state.globalSettings.showJoinsParts
      ) {
        const server = state.servers.find((s) => s.id === serverId);
        const channel = server?.channels.find(
          (c) => c.name.toLowerCase() === channelName.toLowerCase(),
        );
        if (channel) {
          appendMessage(
            store,
            serverId,
            channel.id,
            makeEventMessage(
              "join",
              t`joined ${channelName}`,
              username,
              channel.id,
              serverId,
              time ? new Date(time) : new Date(),
            ),
          );
        }
      }
    },
  );

  ircClient.on("NICK", ({ serverId, oldNick, newNick, batchTag, mtags }) => {
    if (batchTag) {
      const state = store.getState();
      const batch = state.activeBatches[serverId]?.[batchTag];
      if (batch?.type === "chathistory") {
        // Historical nick change from event-playback — create a message record, skip live mutation.
        if (
          state.globalSettings.showEvents &&
          state.globalSettings.showNickChanges
        ) {
          const channelName = batch.parameters?.[0];
          if (channelName) {
            const server = state.servers.find((s) => s.id === serverId);
            const channel = server?.channels.find(
              (c) => c.name.toLowerCase() === channelName.toLowerCase(),
            );
            if (channel) {
              const ourNick = ircClient.getNick(serverId);
              const isOurNickChange =
                oldNick === ourNick || newNick === ourNick;
              appendMessage(
                store,
                serverId,
                channel.id,
                makeEventMessage(
                  "nick",
                  isOurNickChange
                    ? t`are now known as **${newNick}**`
                    : t`is now known as **${newNick}**`,
                  oldNick,
                  channel.id,
                  serverId,
                  mtags?.time ? new Date(mtags.time) : new Date(),
                  true,
                ),
              );
            }
          }
        }
        return;
      }
    }
    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            const updatedUsers = channel.users.map((user) => {
              if (user.username === oldNick) {
                return { ...user, username: newNick };
              }
              return user;
            });
            return { ...channel, users: updatedUsers };
          });
          return { ...server, channels: updatedChannels };
        }
        return server;
      });

      // Update currentUser only if this nick change is for the currently selected server
      // and it's our own nick that changed
      let updatedCurrentUser = state.currentUser;
      const isSelectedServer = state.ui.selectedServerId === serverId;
      const serverCurrentUser = ircClient.getCurrentUser(serverId);
      const isOurNick =
        serverCurrentUser?.username === oldNick ||
        serverCurrentUser?.username === newNick;

      if (
        isSelectedServer &&
        isOurNick &&
        state.currentUser &&
        state.currentUser.username === oldNick
      ) {
        updatedCurrentUser = { ...state.currentUser, username: newNick };
      }

      return {
        servers: updatedServers,
        currentUser: updatedCurrentUser,
      };
    });

    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (
      server &&
      state.globalSettings.showEvents &&
      state.globalSettings.showNickChanges
    ) {
      const ourNick = ircClient.getNick(serverId);
      const isOurNickChange = oldNick === ourNick || newNick === ourNick;
      const nickContent = isOurNickChange
        ? t`are now known as **${newNick}**`
        : t`is now known as **${newNick}**`;

      server.channels.forEach((channel) => {
        const userWasInChannel = channel.users.some(
          (user) => user.username === newNick,
        );
        if (userWasInChannel) {
          appendMessage(
            store,
            serverId,
            channel.id,
            makeEventMessage(
              "nick",
              nickContent,
              oldNick, // userId is old nick so the message avatar/link resolves correctly
              channel.id,
              serverId,
              new Date(),
            ),
          );
        }
      });

      const privateChat = server.privateChats?.find(
        (pc) =>
          pc.username.toLowerCase() === oldNick.toLowerCase() ||
          pc.username.toLowerCase() === newNick.toLowerCase(),
      );
      if (privateChat) {
        store.setState((state) => {
          const updatedServers = state.servers.map((s) => {
            if (s.id === serverId) {
              const updatedPrivateChats = s.privateChats?.map((pc) => {
                if (pc.username.toLowerCase() === oldNick.toLowerCase()) {
                  return { ...pc, username: newNick };
                }
                return pc;
              });
              return { ...s, privateChats: updatedPrivateChats };
            }
            return s;
          });
          return { servers: updatedServers };
        });

        appendMessage(
          store,
          serverId,
          privateChat.id,
          makeEventMessage(
            "nick",
            nickContent,
            oldNick,
            privateChat.id,
            serverId,
            new Date(),
          ),
        );
      }
    }
  });

  ircClient.on("QUIT", ({ serverId, username, reason, batchTag, time }) => {
    if (batchTag) {
      const state = store.getState();
      const batch = state.activeBatches[serverId]?.[batchTag];
      if (batch) {
        if (batch.type === "chathistory") {
          // Historical quit from event-playback — create a message record, skip live mutation.
          if (
            state.globalSettings.showEvents &&
            state.globalSettings.showQuits
          ) {
            const channelName = batch.parameters?.[0];
            if (channelName) {
              const server = state.servers.find((s) => s.id === serverId);
              const channel = server?.channels.find(
                (c) => c.name.toLowerCase() === channelName.toLowerCase(),
              );
              if (channel) {
                appendMessage(
                  store,
                  serverId,
                  channel.id,
                  makeEventMessage(
                    "quit",
                    reason ? t`quit (${reason})` : t`quit`,
                    username,
                    channel.id,
                    serverId,
                    time ? new Date(time) : new Date(),
                    true,
                  ),
                );
              }
            }
          }
          return;
        }
        // Netsplit/netjoin batch — defer to batch handler
        batch.events.push({
          type: "QUIT",
          data: { serverId, username, reason },
        });
        return;
      }
    }

    // Capture which channels the user was in before the store mutation removes them
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    const channelsUserWasIn: string[] = [];

    if (server) {
      server.channels.forEach((channel) => {
        const userWasInChannel = channel.users.some(
          (user) => user.username === username,
        );
        if (userWasInChannel) {
          channelsUserWasIn.push(channel.id);
        }
      });
    }

    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            const updatedUsers = channel.users.filter(
              (user) => user.username !== username,
            );
            return { ...channel, users: updatedUsers };
          });

          return { ...server, channels: updatedChannels };
        }
        return server;
      });

      return { servers: updatedServers };
    });

    if (state.globalSettings.showEvents && state.globalSettings.showQuits) {
      if (server) {
        const quitContent = reason ? t`quit (${reason})` : t`quit`;
        server.channels.forEach((channel) => {
          if (channelsUserWasIn.includes(channel.id)) {
            appendMessage(
              store,
              serverId,
              channel.id,
              makeEventMessage(
                "quit",
                quitContent,
                username,
                channel.id,
                serverId,
                new Date(),
              ),
            );
          }
        });
      }
    }

    if (server) {
      channelsUserWasIn.forEach((channelId) => {
        const key = `${serverId}-${channelId}`;
        store.setState((state) => {
          const currentUsers = state.typingUsers[key] || [];
          const currentTimers = state.typingTimers[key] || {};

          if (currentTimers[username]) {
            clearTimeout(currentTimers[username]);
          }

          const { [username]: removedTimer, ...remainingTimers } =
            currentTimers;

          return {
            typingUsers: {
              ...state.typingUsers,
              [key]: currentUsers.filter((u) => u.username !== username),
            },
            typingTimers: {
              ...state.typingTimers,
              [key]: remainingTimers,
            },
          };
        });
      });
    }
  });

  ircClient.on(
    "PART",
    ({ serverId, username, channelName, reason, batchTag, time }) => {
      if (batchTag) {
        const state = store.getState();
        const batch = state.activeBatches[serverId]?.[batchTag];
        if (batch?.type === "chathistory") {
          // Historical part from event-playback — create a message record, skip live mutation.
          if (
            state.globalSettings.showEvents &&
            state.globalSettings.showJoinsParts
          ) {
            const batchChannelName = batch.parameters?.[0] ?? channelName;
            const server = state.servers.find((s) => s.id === serverId);
            const channel = server?.channels.find(
              (c) => c.name.toLowerCase() === batchChannelName.toLowerCase(),
            );
            if (channel) {
              appendMessage(
                store,
                serverId,
                channel.id,
                makeEventMessage(
                  "part",
                  reason
                    ? t`left ${channelName} (${reason})`
                    : t`left ${channelName}`,
                  username,
                  channel.id,
                  serverId,
                  time ? new Date(time) : new Date(),
                  true,
                ),
              );
            }
          }
          return;
        }
      }
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((channel) => {
              if (channel.name.toLowerCase() === channelName.toLowerCase()) {
                return {
                  ...channel,
                  users: channel.users.filter(
                    (user) => user.username !== username,
                  ),
                };
              }
              return channel;
            });
            return { ...server, channels: updatedChannels };
          }
          return server;
        });

        return { servers: updatedServers };
      });

      const state = store.getState();
      if (
        state.globalSettings.showEvents &&
        state.globalSettings.showJoinsParts
      ) {
        const server = state.servers.find((s) => s.id === serverId);
        if (server) {
          const channel = server.channels.find((c) => c.name === channelName);
          if (channel) {
            appendMessage(
              store,
              serverId,
              channel.id,
              makeEventMessage(
                "part",
                reason
                  ? t`left ${channelName} (${reason})`
                  : t`left ${channelName}`,
                username,
                channel.id,
                serverId,
                new Date(),
              ),
            );
          }
        }
      }

      const server = state.servers.find((s) => s.id === serverId);
      if (server) {
        const channel = server.channels.find((c) => c.name === channelName);
        if (channel) {
          const key = `${serverId}-${channel.id}`;
          store.setState((state) => {
            const currentUsers = state.typingUsers[key] || [];
            const currentTimers = state.typingTimers[key] || {};

            if (currentTimers[username]) {
              clearTimeout(currentTimers[username]);
            }

            const { [username]: removedTimer, ...remainingTimers } =
              currentTimers;

            return {
              typingUsers: {
                ...state.typingUsers,
                [key]: currentUsers.filter((u) => u.username !== username),
              },
              typingTimers: {
                ...state.typingTimers,
                [key]: remainingTimers,
              },
            };
          });
        }
      }
    },
  );

  ircClient.on(
    "KICK",
    ({ serverId, username, target, channelName, reason }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          const updatedChannels = server.channels.map((channel) => {
            if (channel.name.toLowerCase() === channelName.toLowerCase()) {
              return {
                ...channel,
                users: channel.users.filter((user) => user.username !== target),
              };
            }
            return channel;
          });
          return { ...server, channels: updatedChannels };
        });

        return { servers: updatedServers };
      });

      const state = store.getState();
      if (state.globalSettings.showEvents && state.globalSettings.showKicks) {
        const server = state.servers.find((s) => s.id === serverId);
        if (server) {
          const channel = server.channels.find((c) => c.name === channelName);
          if (channel) {
            appendMessage(
              store,
              serverId,
              channel.id,
              makeEventMessage(
                "kick",
                reason
                  ? t`was kicked from ${channelName} by ${username} (${reason})`
                  : t`was kicked from ${channelName} by ${username}`,
                target,
                channel.id,
                serverId,
                new Date(),
              ),
            );
          }
        }
      }

      const server = state.servers.find((s) => s.id === serverId);
      if (server) {
        const channel = server.channels.find((c) => c.name === channelName);
        if (channel) {
          const key = `${serverId}-${channel.id}`;
          store.setState((state) => {
            const currentUsers = state.typingUsers[key] || [];
            const currentTimers = state.typingTimers[key] || {};

            if (currentTimers[target]) {
              clearTimeout(currentTimers[target]);
            }

            const { [target]: removedTimer, ...remainingTimers } =
              currentTimers;

            return {
              typingUsers: {
                ...state.typingUsers,
                [key]: currentUsers.filter((u) => u.username !== target),
              },
              typingTimers: {
                ...state.typingTimers,
                [key]: remainingTimers,
              },
            };
          });
        }
      }
    },
  );

  ircClient.on("INVITE", ({ serverId, inviter, target, channel }) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;

    const currentUser = ircClient.getCurrentUser(serverId);
    if (!currentUser) return;

    let targetChannelId: string | null = null;
    let targetChannelName: string | null = null;

    // Show in the currently selected channel; private chats fall through to channel fallback
    if (state.ui.selectedServerId === serverId) {
      const currentSelection = getCurrentSelection(state);
      if (currentSelection.selectedChannelId) {
        const selectedChannel = server.channels.find(
          (c) => c.id === currentSelection.selectedChannelId,
        );
        if (selectedChannel) {
          targetChannelId = selectedChannel.id;
          targetChannelName = selectedChannel.name;
        }
      } else if (currentSelection.selectedPrivateChatId) {
        targetChannelId = currentSelection.selectedPrivateChatId;
      }
    }

    if (!targetChannelId && server.channels.length > 0) {
      targetChannelId = server.channels[0].id;
      targetChannelName = server.channels[0].name;
    }

    if (!targetChannelId) return;

    const isForCurrentUser =
      target.toLowerCase() === currentUser.username.toLowerCase();
    const content = isForCurrentUser
      ? t`${inviter} has invited you to join ${channel}`
      : t`${inviter} has invited ${target} to join ${channel}`;

    const inviteMessage: Message = {
      ...makeEventMessage(
        "invite",
        content,
        inviter,
        targetChannelId,
        serverId,
        new Date(),
      ),
      inviteChannel: channel,
      inviteTarget: target,
    };

    appendMessage(store, serverId, targetChannelId, inviteMessage);
  });

  ircClient.on("INVITE_SENT", ({ serverId, target, channel }) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;

    // Show the confirmation in the currently selected channel on this server
    const selection = state.ui.perServerSelections[serverId];
    const targetChannelId =
      selection?.selectedChannelId ?? server.channels[0]?.id ?? null;
    if (!targetChannelId) return;

    const inviteMessage: Message = {
      ...makeEventMessage(
        "invite",
        t`You invited ${target} to join ${channel}`,
        "",
        targetChannelId,
        serverId,
        new Date(),
      ),
      inviteChannel: channel,
      inviteTarget: target,
    };

    appendMessage(store, serverId, targetChannelId, inviteMessage);
  });

  ircClient.on("NICK_ERROR", ({ serverId, code, error, nick, message }) => {
    if (code === "433" && nick) {
      const newNick = `${nick}_`;
      ircClient.changeNick(serverId, newNick);

      const state = store.getState();
      const server = state.servers.find((s) => s.id === serverId);
      if (server && getCurrentSelection(state).selectedChannelId) {
        const channel = server.channels.find(
          (c) => c.id === getCurrentSelection(state).selectedChannelId,
        );
        if (channel) {
          appendMessage(
            store,
            serverId,
            channel.id,
            makeEventMessage(
              "system",
              t`Nickname '${nick}' already in use, retrying with '${newNick}'`,
              "system",
              channel.id,
              serverId,
              new Date(),
            ),
          );
        }
      }

      // Don't show error notification for 433 since we're auto-retrying
      return;
    }

    const state = store.getState();
    state.addGlobalNotification({
      type: "fail",
      command: "NICK",
      code,
      message: `${error}: ${message}`,
      target: nick,
      serverId,
    });

    const server = state.servers.find((s) => s.id === serverId);
    if (server && getCurrentSelection(state).selectedChannelId) {
      const channel = server.channels.find(
        (c) => c.id === getCurrentSelection(state).selectedChannelId,
      );
      if (channel) {
        appendMessage(
          store,
          serverId,
          channel.id,
          makeEventMessage(
            "system",
            t`Nick change failed: ${error} ${nick ? `(${nick})` : ""}`,
            "system",
            channel.id,
            serverId,
            new Date(),
          ),
        );
      }
    }
  });

  ircClient.on("FAIL", ({ serverId, command, code, target, message }) => {
    const state = store.getState();
    state.addGlobalNotification({
      type: "fail",
      command,
      code,
      message,
      target,
      serverId,
    });
    // A CHATHISTORY FAIL never opens a batch, so the LOADING(false)
    // event that normally chains the WHO request will never fire on
    // its own. Synthesise it here so the channel doesn't stay
    // permanently flagged needsWhoRequest=true.
    if (command === "CHATHISTORY" && target && target.startsWith("#")) {
      ircClient.triggerEvent("CHATHISTORY_LOADING", {
        serverId,
        channelName: target,
        isLoading: false,
      });
    }
  });

  ircClient.on(
    "WARN",
    ({ serverId, command, code, target, context, message }) => {
      const state = store.getState();
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return;
      const selectedId = getCurrentSelection(state).selectedChannelId;
      const channel =
        server.channels.find((c) => c.id === selectedId) ?? server.channels[0];
      if (channel) {
        const notificationMessage: Message = {
          ...makeEventMessage(
            "standard-reply",
            message,
            "system",
            channel.id,
            serverId,
            new Date(),
          ),
          standardReplyType: "WARN",
          standardReplyCommand: command,
          standardReplyCode: code,
          standardReplyTarget: target,
          standardReplyContext: context,
          standardReplyMessage: message,
        };
        appendMessage(store, serverId, channel.id, notificationMessage);
      } else {
        // No channels yet (pre-join WARN): surface as a global notification
        // instead of dropping it.
        state.addGlobalNotification({
          type: "warn",
          command,
          code,
          message,
          target,
          serverId,
        });
      }
    },
  );

  ircClient.on(
    "NOTE",
    ({ serverId, command, code, target, context, message }) => {
      const state = store.getState();
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return;
      const selectedId = getCurrentSelection(state).selectedChannelId;
      const channel =
        server.channels.find((c) => c.id === selectedId) ?? server.channels[0];
      if (channel) {
        const notificationMessage: Message = {
          ...makeEventMessage(
            "standard-reply",
            message,
            "system",
            channel.id,
            serverId,
            new Date(),
          ),
          standardReplyType: "NOTE",
          standardReplyCommand: command,
          standardReplyCode: code,
          standardReplyTarget: target,
          standardReplyContext: context,
          standardReplyMessage: message,
        };
        appendMessage(store, serverId, channel.id, notificationMessage);
      } else {
        state.addGlobalNotification({
          type: "note",
          command,
          code,
          message,
          target,
          serverId,
        });
      }
    },
  );

  ircClient.on("RENAME", ({ serverId, oldName, newName, reason, user }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      const channel = server.channels.find((c) => c.name === oldName);
      if (!channel) return {};

      channel.name = newName;

      const renameMessage: Message = {
        id: `rename-${Date.now()}`,
        content: t`Channel has been renamed from ${oldName} to ${newName} by ${user}${reason ? ` (${reason})` : ""}`,
        timestamp: new Date(),
        userId: "system",
        channelId: channel.id,
        serverId,
        type: "system",
        reactions: [],
        replyMessage: null,
        mentioned: [],
      };

      const channelKey = `${serverId}-${channel.id}`;
      const currentMessages = state.messages[channelKey] || [];
      return {
        messages: {
          ...state.messages,
          [channelKey]: [...currentMessages, renameMessage],
        },
      };
    });
  });

  ircClient.on("SETNAME", ({ serverId, user, realname, ident, host }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      const isSelf = user === ircClient.getNick(serverId);

      if (isSelf) {
        // Self-SETNAME: update currentUser realname and, if we have prefix info from
        // the draft/whoami registration burst, record myIdent/myHost on the server.
        const updatedServers =
          ident && host
            ? state.servers.map((s) =>
                s.id === serverId ? { ...s, myIdent: ident, myHost: host } : s,
              )
            : state.servers;
        return {
          currentUser: state.currentUser
            ? { ...state.currentUser, realname }
            : state.currentUser,
          servers: updatedServers,
        };
      }

      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedChannels = s.channels.map((c) => ({
            ...c,
            users: c.users.map((u) =>
              u.username === user ? { ...u, realname: realname } : u,
            ),
          }));
          return { ...s, channels: updatedChannels };
        }
        return s;
      });

      return { servers: updatedServers };
    });
  });

  ircClient.on("MONONLINE", ({ serverId, targets }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedPrivateChats = s.privateChats?.map((pm) => {
            const target = targets.find(
              (t) => t.nick.toLowerCase() === pm.username.toLowerCase(),
            );
            if (target) {
              // Correct the stored username to the server-authoritative casing
              return {
                ...pm,
                isOnline: true,
                isAway: false,
                username: target.nick,
              };
            }
            return pm;
          });
          return { ...s, privateChats: updatedPrivateChats };
        }
        return s;
      });

      return { servers: updatedServers };
    });
  });

  ircClient.on("MONOFFLINE", ({ serverId, targets }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedPrivateChats = s.privateChats?.map((pm) => {
            const isOffline = targets.some(
              (t) => t.toLowerCase() === pm.username.toLowerCase(),
            );
            if (isOffline) {
              return { ...pm, isOnline: false, isAway: false };
            }
            return pm;
          });
          return { ...s, privateChats: updatedPrivateChats };
        }
        return s;
      });

      return { servers: updatedServers };
    });
  });

  // away-notify extension
  ircClient.on("AWAY", ({ serverId, username, awayMessage }) => {
    store.setState((state) => {
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return {};

      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedPrivateChats = s.privateChats?.map((pm) => {
            if (pm.username.toLowerCase() === username.toLowerCase()) {
              return {
                ...pm,
                isAway: awayMessage !== undefined && awayMessage !== null,
                awayMessage: awayMessage || undefined,
                isOnline: true, // They're still online, just away
              };
            }
            return pm;
          });
          return { ...s, privateChats: updatedPrivateChats };
        }
        return s;
      });

      return { servers: updatedServers };
    });
  });

  ircClient.on("RPL_AWAY", ({ serverId, nick, awayMessage }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedPrivateChats = s.privateChats?.map((pm) => {
            if (pm.username.toLowerCase() === nick.toLowerCase()) {
              return {
                ...pm,
                awayMessage: awayMessage || undefined,
                isAway: true,
              };
            }
            return pm;
          });
          return { ...s, privateChats: updatedPrivateChats };
        }
        return s;
      });

      return { servers: updatedServers };
    });
  });

  ircClient.on("AWAY", ({ serverId, username, awayMessage }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedChannels = s.channels.map((channel) => {
            const updatedUsers = channel.users.map((user) => {
              if (user.username === username) {
                const newIsAway = !!awayMessage;
                const newAwayMessage = awayMessage || undefined;

                if (
                  user.isAway === newIsAway &&
                  user.awayMessage === newAwayMessage
                ) {
                  return user;
                }

                return {
                  ...user,
                  isAway: newIsAway,
                  awayMessage: newAwayMessage,
                };
              }
              return user;
            });

            if (updatedUsers === channel.users) {
              return channel;
            }

            return { ...channel, users: updatedUsers };
          });

          if (updatedChannels === s.channels) {
            return s;
          }

          return { ...s, channels: updatedChannels };
        }
        return s;
      });

      let updatedCurrentUser = state.currentUser;
      if (state.currentUser?.username === username) {
        const newIsAway = !!awayMessage;
        const newAwayMessage = awayMessage || undefined;

        if (
          state.currentUser.isAway !== newIsAway ||
          state.currentUser.awayMessage !== newAwayMessage
        ) {
          updatedCurrentUser = {
            ...state.currentUser,
            isAway: newIsAway,
            awayMessage: newAwayMessage,
          };
        }
      }

      if (
        updatedServers === state.servers &&
        updatedCurrentUser === state.currentUser
      ) {
        return {};
      }

      return { servers: updatedServers, currentUser: updatedCurrentUser };
    });
  });

  ircClient.on("CHGHOST", ({ serverId, username, newUser, newHost }) => {
    store.setState((state) => {
      const isSelf = username === ircClient.getNick(serverId);

      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedChannels = s.channels.map((channel) => {
            const updatedUsers = channel.users.map((user) => {
              if (user.username === username && user.hostname !== newHost) {
                return {
                  ...user,
                  hostname: newHost,
                };
              }
              return user;
            });

            if (updatedUsers === channel.users) {
              return channel;
            }

            return { ...channel, users: updatedUsers };
          });

          const updatedServerUsers = s.users.map((user) => {
            if (user.username === username && user.hostname !== newHost) {
              return {
                ...user,
                hostname: newHost,
              };
            }
            return user;
          });

          const selfChanged =
            isSelf && (s.myIdent !== newUser || s.myHost !== newHost);

          if (
            updatedChannels === s.channels &&
            updatedServerUsers === s.users &&
            !selfChanged
          ) {
            return s;
          }

          return {
            ...s,
            channels: updatedChannels,
            users: updatedServerUsers,
            ...(selfChanged ? { myIdent: newUser, myHost: newHost } : {}),
          };
        }
        return s;
      });

      let updatedCurrentUser = state.currentUser;
      if (
        state.currentUser?.username === username &&
        state.currentUser.hostname !== newHost
      ) {
        updatedCurrentUser = {
          ...state.currentUser,
          hostname: newHost,
        };
      }

      if (
        updatedServers === state.servers &&
        updatedCurrentUser === state.currentUser
      ) {
        return {};
      }

      return { servers: updatedServers, currentUser: updatedCurrentUser };
    });
  });

  // Handle 306 numeric - we are now marked as away
  ircClient.on("RPL_NOWAWAY", ({ serverId, message }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          return {
            ...s,
            isAway: true,
            awayMessage: message,
          };
        }
        return s;
      });

      // Update current user if this is the selected server
      let updatedCurrentUser = state.currentUser;
      if (state.ui.selectedServerId === serverId && state.currentUser) {
        updatedCurrentUser = {
          ...state.currentUser,
          isAway: true,
          awayMessage: message,
        };
      }

      return { servers: updatedServers, currentUser: updatedCurrentUser };
    });
  });

  // Handle 305 numeric - we are no longer marked as away
  ircClient.on("RPL_UNAWAY", ({ serverId, message }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          return {
            ...s,
            isAway: false,
            awayMessage: undefined,
          };
        }
        return s;
      });

      // Update current user if this is the selected server
      let updatedCurrentUser = state.currentUser;
      if (state.ui.selectedServerId === serverId && state.currentUser) {
        updatedCurrentUser = {
          ...state.currentUser,
          isAway: false,
          awayMessage: undefined,
        };
      }

      return { servers: updatedServers, currentUser: updatedCurrentUser };
    });
  });
}
