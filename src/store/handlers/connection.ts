import type { StoreApi } from "zustand";
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

// Track which servers have had their ready handler run to prevent duplicate processing
export const readyProcessedServers = new Set<string>();

export function registerConnectionHandlers(store: StoreApi<AppState>): void {
  ircClient.on("connectionStateChange", ({ serverId, connectionState }) => {
    // Allow the ready handler to re-run metadata restoration after reconnect
    if (connectionState === "disconnected") {
      readyProcessedServers.delete(serverId);
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

    // Sync our own metadata in the background -- don't await so channel
    // joins happen immediately.
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
      fetchAndMergeOwnMetadata(store, serverId).then(() => {
        const savedMetadataAfterMerge = storage.metadata.load();
        const serverMetadataAfterMerge = savedMetadataAfterMerge[serverId];
        const ourNick = ircClient.getNick(serverId);
        if (serverMetadataAfterMerge && ourNick) {
          const ourMetadata = serverMetadataAfterMerge[ourNick];
          if (ourMetadata) {
            Object.entries(ourMetadata).forEach(
              ([key, { value, visibility }]) => {
                if (value !== undefined) {
                  store
                    .getState()
                    .metadataSet(serverId, "*", key, value, visibility);
                }
              },
            );
          }
        }
      });
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

      for (const channelName of channelsToJoin) {
        if (channelName) {
          store.getState().joinChannel(serverId, channelName);
        }
      }

      // chathistoryRequested is reset to false on disconnect — re-fetch missed history
      // for channels that were already joined (ircClient.joinChannel early-returns for them,
      // so CHATHISTORY never gets sent through the normal join path)
      setTimeout(() => {
        const reconnectedServer = store
          .getState()
          .servers.find((s) => s.id === serverId);
        if (!reconnectedServer) return;
        for (const ch of reconnectedServer.channels) {
          if (!ch.chathistoryRequested) {
            ircClient.sendRaw(serverId, `CHATHISTORY LATEST ${ch.name} * 50`);
          }
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

        if (server && savedChannelId) {
          const channelExists = server.channels.some(
            (c) => c.id === savedChannelId,
          );
          if (!channelExists) {
            // ID mismatch - try to restore by name
            const savedName = serverSelection?.selectedChannelName;
            const matchedByName = savedName
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
          ircClient.sendRaw(serverId, `CHATHISTORY LATEST ${username} * 50`);
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

// Inlined from fetchAndMergeOwnMetadata in index.ts — uses store instead of useStore
async function fetchAndMergeOwnMetadata(
  store: StoreApi<AppState>,
  serverId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const nickname = ircClient.getNick(serverId);
    if (!nickname) {
      resolve();
      return;
    }

    // Mark as fetching
    store.setState((state) => ({
      metadataFetchInProgress: {
        ...state.metadataFetchInProgress,
        [serverId]: true,
      },
    }));

    // Request all metadata for ourselves (target "*" means us)
    const defaultKeys = [
      "url",
      "website",
      "status",
      "location",
      "avatar",
      "color",
      "display-name",
    ];

    // Get our metadata from the server
    ircClient.metadataGet(serverId, "*", defaultKeys);

    // Wait a bit for responses to come in, then resolve
    // The METADATA_KEYVALUE handler will update saved values
    setTimeout(() => {
      store.setState((state) => ({
        metadataFetchInProgress: {
          ...state.metadataFetchInProgress,
          [serverId]: false,
        },
      }));
      resolve();
    }, 1000);
  });
}
