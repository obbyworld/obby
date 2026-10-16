import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { isLiveChannel } from "../../lib/channelFolders";
import ircClient from "../../lib/ircClient";
import type { PrivateChat } from "../../types";
import {
  generateDeterministicId,
  getServerSelection,
  serverSupportsMetadata,
  setServerSelection,
} from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";
import { reportServerReply } from "./serverReplies";

// Track which servers have had their ready handler run to prevent duplicate processing
export const readyProcessedServers = new Set<string>();

export function registerConnectionHandlers(store: StoreApi<AppState>): void {
  ircClient.on("MOTD", ({ serverId, lines }) => {
    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId ? { ...server, motd: lines } : server,
      ),
    }));
    const { globalSettings, servers, addMessage } = store.getState();
    if (!globalSettings.showMotd) return;
    addMessage({
      id: uuidv4(),
      type: "notice",
      content: lines.join("\n"),
      timestamp: new Date(),
      userId: servers.find((s) => s.id === serverId)?.name ?? "MOTD",
      channelId: "server-notices",
      serverId,
      reactions: [],
      replyMessage: null,
      mentioned: [],
    });
  });

  ircClient.on("rateLimited", ({ serverId, message }) =>
    reportServerReply(store, {
      serverId,
      type: "warn",
      command: "ERROR",
      code: "RATE_LIMITED",
      message,
    }),
  );

  ircClient.on("serverError", ({ serverId, message }) =>
    reportServerReply(store, {
      serverId,
      type: "fail",
      command: "ERROR",
      code: "SERVER_ERROR",
      message,
    }),
  );

  ircClient.on("rawLine", ({ serverId, direction, line }) => {
    store.getState().appendRawLogLine({ serverId, direction, line });
  });

  ircClient.on("ISUPPORT", ({ serverId, key, value }) => {
    if (key !== "NETWORK" || !value) return;
    store.setState((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId ? { ...s, networkName: value } : s,
      ),
    }));
  });

  ircClient.on("saslFailed", ({ serverId }) => {
    store.setState((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId ? { ...s, saslFailed: true } : s,
      ),
    }));
  });

  ircClient.on("connectionStateChange", ({ serverId, connectionState }) => {
    // Allow the ready handler to re-run metadata restoration after reconnect
    if (connectionState === "disconnected") {
      readyProcessedServers.delete(serverId);
      // e2ee ratchet keys live only in memory and can't survive a dropped
      // connection, so tear the sessions down rather than keep showing a lock
      // that no longer protects anything. Encryption resumes after reconnecting,
      // which is why this is not the same call the user's End encryption makes.
      store.getState().dropE2EESessionsForServer(serverId);
    }

    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id !== serverId) return server;

        // On disconnect, reset chathistoryRequested so history is re-fetched after rejoin
        const channels =
          connectionState === "disconnected"
            ? server.channels.map((c) => ({
                ...c,
                chathistoryRequested: false,
                needsWhoRequest: true,
              }))
            : server.channels;

        return {
          ...server,
          channels,
          connectionState,
          isConnected: connectionState === "connected",
          saslFailed:
            connectionState === "connecting" ? false : server.saslFailed,
        };
      });

      // If a server just connected and we have no selected server (showing welcome screen),
      // switch back to this server to maintain continuity during reconnection
      let newUi = { ...state.ui };
      if (
        connectionState === "connected" &&
        state.ui.selectedServerId === null
      ) {
        const reconnectedServer = updatedServers.find((s) => s.id === serverId);
        if (reconnectedServer) {
          const serverSelection = getServerSelection(state, serverId);
          newUi = {
            ...newUi,
            selectedServerId: serverId,
            perServerSelections: setServerSelection(
              state,
              serverId,
              serverSelection,
            ),
          };
        }
      }

      return {
        servers: updatedServers,
        ui: newUi,
      };
    });
  });

  ircClient.on("ready", ({ serverId, serverName, nickname }) => {
    // Prevent processing the same server's ready event multiple times
    if (readyProcessedServers.has(serverId)) {
      return;
    }
    readyProcessedServers.add(serverId);

    // Restore metadata for this server (inlined from restoreServerMetadata)
    const savedMetadata = storage.metadata.load();
    const serverMetadata = savedMetadata[serverId];
    if (serverMetadata) {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            // Restore server metadata
            const updatedMetadata = { ...server.metadata };
            if (serverMetadata[server.name]) {
              Object.assign(updatedMetadata, serverMetadata[server.name]);
            }

            // Restore user metadata in channels
            const updatedChannels = server.channels.map((channel) => {
              const updatedUsers = channel.users.map((user) => {
                const userMetadata = serverMetadata[user.username];
                if (userMetadata) {
                  return {
                    ...user,
                    metadata: { ...user.metadata, ...userMetadata },
                  };
                }
                return user;
              });

              // Restore channel metadata
              const channelMetadata = serverMetadata[channel.name];
              const updatedChannelMetadata = {
                ...(channel.metadata ?? {}),
                ...(channelMetadata ?? {}),
              };

              return {
                ...channel,
                users: updatedUsers,
                metadata: updatedChannelMetadata,
              };
            });

            return {
              ...server,
              metadata: updatedMetadata,
              channels: updatedChannels,
            };
          }
          return server;
        });

        // Restore current user metadata
        let updatedCurrentUser = state.currentUser;
        if (state.currentUser && serverMetadata[state.currentUser.username]) {
          updatedCurrentUser = {
            ...state.currentUser,
            metadata: {
              ...state.currentUser.metadata,
              ...serverMetadata[state.currentUser.username],
            },
          };
        }

        return { servers: updatedServers, currentUser: updatedCurrentUser };
      });
    }

    // We read our metadata from the server, which keeps it.
    //
    // We deliberately do NOT send METADATA SUB any more. The server's
    // join-time push of every subscribed key for every existing channel
    // member is the "metadata firehose": on a 500-user channel that's
    // hundreds of pushes in a burst, in the server's internal iteration
    // order (which on rejoin appears reverse-of-set, so users see
    // avatars/display-names trickling in from the bottom of the
    // nicklist). Since the client already lazy-GETs metadata as nicks
    // come into view (MemberList.flushVisible), SUB is pure overhead --
    // we'd be paying the firehose cost twice (once for SUB push, once
    // for our own GETs). Live updates after the initial GET are not
    // visible to us, but display-name / avatar don't change often and
    // the profile modal re-GETs anyway.
    if (serverSupportsMetadata(store.getState(), serverId)) {
      ircClient.metadataGet(serverId, "*", OWN_METADATA_KEYS);
    }

    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          return { ...server, name: serverName }; // Update the server name for display purposes
        }
        return server;
      });

      const ircCurrentUser = ircClient.getCurrentUser(serverId);
      let updatedCurrentUser = state.currentUser;

      if (ircCurrentUser) {
        // Get saved metadata for this user on this server
        const savedMeta = storage.metadata.load();
        const serverMeta = savedMeta[serverId];
        const userMetadata = serverMeta?.[ircCurrentUser.username] || {};

        // Create current user with IRC data and any saved metadata
        updatedCurrentUser = {
          ...ircCurrentUser,
          metadata: {
            ...(state.currentUser?.metadata || {}),
            ...userMetadata,
          },
        };
      }

      return {
        servers: updatedServers,
        currentUser: updatedCurrentUser,
      };
    });

    const savedServers = storage.servers.load();
    const savedServer = savedServers.find((s) => s.id === serverId);

    if (savedServer) {
      // Send OPER command if oper on connect is enabled
      if (
        savedServer.operOnConnect &&
        savedServer.operUsername &&
        savedServer.operPassword
      ) {
        try {
          const decodedPassword = atob(savedServer.operPassword);
          store
            .getState()
            .sendRaw(
              serverId,
              `OPER ${savedServer.operUsername} ${decodedPassword}`,
            );
        } catch (error) {
          console.error("Failed to decode operator password:", error);
          // Fall back to using the password as-is if decoding fails
          store
            .getState()
            .sendRaw(
              serverId,
              `OPER ${savedServer.operUsername} ${savedServer.operPassword}`,
            );
        }
      }

      // Skip client-side rejoin for bouncer sessions; soju replays after BIND.
      const reconnectingServer = store
        .getState()
        .servers.find((s) => s.id === serverId);
      const isBouncerSession =
        !!reconnectingServer?.isBouncerControl ||
        !!reconnectingServer?.bouncerNetid;

      // Get the saved channel order for this server
      const savedChannelOrder = store.getState().channelOrder[serverId];

      // If we have a saved order, use it to determine join sequence
      let channelsToJoin: string[] = savedServer.channels;

      if (savedChannelOrder && savedChannelOrder.length > 0) {
        // Map channel IDs to channel names using the saved order
        // Note: savedChannelOrder has IDs, but we need names for joining
        // We'll join in the order from savedServer.channels which should already be ordered
        channelsToJoin = savedServer.channels;
      }

      if (!isBouncerSession) {
        for (const channelName of channelsToJoin) {
          if (channelName) {
            store.getState().joinChannel(serverId, channelName);
          }
        }
      }

      // Re-fetch CHATHISTORY for already-joined channels: ircClient.joinChannel
      // early-returns for them, so the normal join path doesn't send it.
      // soju bouncer control sessions have no real channels — skip.
      setTimeout(() => {
        const reconnectedServer = store
          .getState()
          .servers.find((s) => s.id === serverId);
        if (!reconnectedServer) return;
        if (reconnectedServer.isBouncerControl) return;
        for (const ch of reconnectedServer.channels) {
          if (!ch.chathistoryRequested)
            ircClient.loadLatestHistory(serverId, ch.name);
        }
      }, 50);

      // Only auto-select welcome page for NEW servers (no saved channels)
      // Existing servers with channels should not auto-select (preserves user's view)
      const isNewServer = savedServer.channels.length === 0;

      const currentState = store.getState();

      // If this is the saved selected server, validate its saved channel selection
      if (currentState.ui.selectedServerId === serverId) {
        const serverSelection = currentState.ui.perServerSelections[serverId];
        const savedChannelId = serverSelection?.selectedChannelId;
        const savedPrivateChatId = serverSelection?.selectedPrivateChatId;
        const server = currentState.servers.find((s) => s.id === serverId);

        const savedChannel = server?.channels.find(
          (c) => c.id === savedChannelId,
        );
        if (savedChannel && isLiveChannel(savedChannel.name)) {
          store.getState().selectChannel(null);
        } else if (server && savedChannelId) {
          const channelExists = !!savedChannel;
          if (!channelExists) {
            // ID mismatch - try to restore by name
            const savedName = serverSelection?.selectedChannelName;
            const matchedByName =
              savedName && !isLiveChannel(savedName)
                ? server.channels.find(
                    (c) => c.name.toLowerCase() === savedName.toLowerCase(),
                  )
                : null;

            if (matchedByName) {
              console.log(
                "[Channel Restore] ID stale, restored by name:",
                savedName,
              );
              store.getState().selectChannel(matchedByName.id);
            } else {
              console.warn(
                "[Channel Restore] Saved channel ID is stale and name not found:",
                savedChannelId,
                savedName,
              );
            }
          }
        } else if (server && savedPrivateChatId) {
          const pcExists = server.privateChats?.some(
            (pc) => pc.id === savedPrivateChatId,
          );
          if (!pcExists) {
            const savedUsername = serverSelection?.selectedPrivateChatUsername;
            if (savedUsername) {
              console.log(
                "[Channel Restore] Private chat ID stale, restoring by username:",
                savedUsername,
              );
              store.getState().openPrivateChat(serverId, savedUsername);
            }
          }
        } else if (server && !savedChannelId && server.channels.length > 0) {
          // No saved channel - try lastSelection fallback
          const uiSelections = storage.uiSelections.load();
          const lastSel = uiSelections.lastSelection;
          if (
            lastSel &&
            server.host.toLowerCase() === lastSel.serverHost.toLowerCase()
          ) {
            if (lastSel.channelName) {
              const channel = server.channels.find(
                (c) =>
                  c.name.toLowerCase() === lastSel.channelName?.toLowerCase(),
              );
              if (channel) {
                console.log(
                  "[Channel Restore] Restored from lastSelection by host+name:",
                  lastSel.channelName,
                );
                store.getState().selectChannel(channel.id);
              }
            } else if (lastSel.privateChatUsername) {
              console.log(
                "[Channel Restore] Restored private chat from lastSelection:",
                lastSel.privateChatUsername,
              );
              store
                .getState()
                .openPrivateChat(serverId, lastSel.privateChatUsername);
            }
          }
        }
      } else if (!currentState.ui.selectedServerId) {
        // No server selected - try to match by lastSelection host
        const uiSelections = storage.uiSelections.load();
        const lastSel = uiSelections.lastSelection;
        const server = currentState.servers.find((s) => s.id === serverId);

        if (
          lastSel &&
          server &&
          server.host.toLowerCase() === lastSel.serverHost.toLowerCase()
        ) {
          // This server matches the last selection by host - select it
          store.setState((state) => ({
            ui: {
              ...state.ui,
              selectedServerId: serverId,
            },
          }));

          if (lastSel.channelName) {
            const channel = server.channels.find(
              (c) =>
                c.name.toLowerCase() === lastSel.channelName?.toLowerCase(),
            );
            if (channel) {
              console.log(
                "[Channel Restore] Cross-ID restore by host+name:",
                lastSel.channelName,
              );
              store.getState().selectChannel(channel.id);
            }
          } else if (lastSel.privateChatUsername) {
            store
              .getState()
              .openPrivateChat(serverId, lastSel.privateChatUsername);
          }
        } else {
          // No lastSelection match - select this server
          store.setState((state) => ({
            ui: {
              ...state.ui,
              selectedServerId: serverId,
              perServerSelections: isNewServer
                ? {
                    ...state.ui.perServerSelections,
                    [serverId]: {
                      selectedChannelId: null,
                      selectedPrivateChatId: null,
                    },
                  }
                : state.ui.perServerSelections,
            },
          }));
        }
      }
    } else {
    }

    // Restore pinned private chats for this server
    const pinnedChats = storage.pinnedChats.load();
    const serverPinnedChats = pinnedChats[serverId] || [];

    if (serverPinnedChats.length > 0) {
      // Sort by order
      const sortedPinnedChats = [...serverPinnedChats].sort(
        (a, b) => a.order - b.order,
      );

      store.setState((state) => {
        const server = state.servers.find((s) => s.id === serverId);
        if (!server) return {};

        // Create private chat objects for pinned users
        const restoredPrivateChats: PrivateChat[] = sortedPinnedChats.map(
          ({ username, order }) => ({
            id: generateDeterministicId(serverId, username),
            username,
            serverId,
            unreadCount: 0,
            isMentioned: false,
            lastActivity: new Date(),
            isPinned: true,
            order,
            isOnline: false, // Will be updated by MONITOR
            isAway: false,
          }),
        );

        const updatedServers = state.servers.map((s) => {
          if (s.id === serverId) {
            // Merge existing private chats with restored pinned chats, deduplicating by username
            const existingChats = s.privateChats || [];
            const mergedPrivateChats = [...existingChats];

            for (const restoredChat of restoredPrivateChats) {
              const existingIndex = mergedPrivateChats.findIndex(
                (pc) =>
                  pc.username.toLowerCase() ===
                  restoredChat.username.toLowerCase(),
              );
              if (existingIndex === -1) {
                // Chat doesn't exist, add it
                mergedPrivateChats.push(restoredChat);
              } else {
                // Chat exists, ensure it's marked as pinned with correct order
                mergedPrivateChats[existingIndex] = {
                  ...mergedPrivateChats[existingIndex],
                  isPinned: true,
                  order: restoredChat.order,
                };
              }
            }

            return {
              ...s,
              privateChats: mergedPrivateChats,
            };
          }
          return s;
        });

        return { servers: updatedServers };
      });

      // MONITOR all pinned users
      const usernames = sortedPinnedChats.map((pc) => pc.username);
      ircClient.monitorAdd(serverId, usernames);

      // Request chathistory for each pinned PM
      setTimeout(() => {
        for (const { username } of sortedPinnedChats) {
          ircClient.requestChathistoryLatest(serverId, username);
        }
      }, 50);

      // For each pinned user, check if we have their info from channels first
      setTimeout(() => {
        const state = store.getState();
        const server = state.servers.find((s) => s.id === serverId);
        if (!server) return;

        for (const { username } of sortedPinnedChats) {
          // Check if we already have user info from channels
          let hasUserInfo = false;
          for (const channel of server.channels) {
            const user = channel.users.find(
              (u) => u.username.toLowerCase() === username.toLowerCase(),
            );
            if (user?.realname && user.account !== undefined) {
              // We have complete user info, copy it to the PM
              hasUserInfo = true;
              store.setState((state) => ({
                servers: state.servers.map((s) => {
                  if (s.id === serverId) {
                    return {
                      ...s,
                      privateChats: s.privateChats?.map((pm) => {
                        if (
                          pm.username.toLowerCase() === username.toLowerCase()
                        ) {
                          return {
                            ...pm,
                            realname: user.realname,
                            account: user.account,
                            isBot: user.isBot,
                          };
                        }
                        return pm;
                      }),
                    };
                  }
                  return s;
                }),
              }));
              break;
            }
          }

          // Only request WHO if we don't have complete user info
          if (!hasUserInfo) {
            // Request WHO to get current status using WHOX to also get account
            // Fields: u=username, h=hostname, n=nickname, f=flags, a=account, r=realname
            ircClient.sendRaw(serverId, `WHO ${username} %cuhnfrao`);
          }
        }
      }, 100);

      // Note: We don't request METADATA GET for individual users as some servers reject this.
      // Instead, we rely on metadata from shared channels (if user is in a channel with us)
      // or from localStorage if we previously got their metadata.
    }
  });
}

// The profile fields the settings page edits.
const OWN_METADATA_KEYS = [
  "display-name",
  "avatar",
  "homepage",
  "status",
  "color",
  "bot",
  "pronouns",
];
