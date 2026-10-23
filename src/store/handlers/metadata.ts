import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { AppState } from "../index";
import * as storage from "../localStorage";

export function registerMetadataHandlers(store: StoreApi<AppState>): void {
  ircClient.on("METADATA", ({ serverId, target, key, visibility, value }) => {
    store.setState((state) => {
      // Resolve the target - if it's "*", it refers to the current user
      const serverCurrentUser = ircClient.getCurrentUser(serverId);
      const resolvedTarget =
        target === "*"
          ? ircClient.getNick(serverId) || serverCurrentUser?.username || target
          : target.split("!")[0]; // Extract nickname from mask

      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          // Update metadata for users in channels
          const updatedChannels = server.channels.map((channel) => {
            const updatedUsers = channel.users.map((user) => {
              if (user.username === resolvedTarget) {
                const metadata = { ...(user.metadata || {}) };
                if (value) {
                  metadata[key] = { value, visibility };
                } else {
                  delete metadata[key];
                }
                return { ...user, metadata };
              }
              return user;
            });

            // Update metadata for the channel itself if target matches channel name
            const channelMetadata = { ...(channel.metadata || {}) };
            if (resolvedTarget === channel.name) {
              if (value) {
                channelMetadata[key] = { value, visibility };
              } else {
                delete channelMetadata[key];
              }
            }

            return {
              ...channel,
              users: updatedUsers,
              metadata: channelMetadata,
            };
          });

          // Update metadata for the server itself if target is server
          const updatedMetadata = { ...(server.metadata || {}) };
          if (resolvedTarget === server.name) {
            if (value) {
              updatedMetadata[key] = { value, visibility };
            } else {
              delete updatedMetadata[key];
            }
          }

          // Update metadata for private chat users
          const updatedPrivateChats = server.privateChats?.map((pm) => {
            if (pm.username.toLowerCase() === resolvedTarget.toLowerCase()) {
              const pmMetadata = { ...(pm.metadata || {}) };
              if (value) {
                pmMetadata[key] = { value, visibility };
              } else {
                delete pmMetadata[key];
              }
              return { ...pm, metadata: pmMetadata };
            }
            return pm;
          });

          return {
            ...server,
            channels: updatedChannels,
            metadata: updatedMetadata,
            privateChats: updatedPrivateChats,
          };
        }
        return server;
      });

      // Update current user metadata if the target matches any connected user
      let updatedCurrentUser = state.currentUser;
      const currentUserForServer = ircClient.getCurrentUser(serverId);

      // Check if this metadata is for the current user on this server
      if (
        currentUserForServer &&
        currentUserForServer.username === resolvedTarget
      ) {
        // If this is the first time setting current user or it's for the selected server, update global state
        if (!updatedCurrentUser || state.ui.selectedServerId === serverId) {
          const metadata = { ...(currentUserForServer.metadata || {}) };
          if (value) {
            metadata[key] = { value, visibility };
          } else {
            delete metadata[key];
          }
          // Preserve existing isIrcOp and modes when updating currentUser
          updatedCurrentUser = {
            ...currentUserForServer,
            metadata,
            isIrcOp: state.currentUser?.isIrcOp,
            modes: state.currentUser?.modes,
          };
        }
        // If there's already a current user but it's for a different server,
        // still update if this is the selected server or if there's no current user
        else if (
          state.currentUser &&
          state.currentUser.username === resolvedTarget
        ) {
          const metadata = { ...(state.currentUser.metadata || {}) };
          if (value) {
            metadata[key] = { value, visibility };
          } else {
            delete metadata[key];
          }
          // Preserve existing isIrcOp and modes when updating currentUser
          updatedCurrentUser = {
            ...state.currentUser,
            metadata,
            isIrcOp: state.currentUser.isIrcOp,
            modes: state.currentUser.modes,
          };
        }
      }

      // Save metadata to localStorage
      const savedMetadata = storage.metadata.load();
      if (!savedMetadata[serverId]) {
        savedMetadata[serverId] = {};
      }
      if (!savedMetadata[serverId][resolvedTarget]) {
        savedMetadata[serverId][resolvedTarget] = {};
      }
      if (value) {
        savedMetadata[serverId][resolvedTarget][key] = { value, visibility };
      } else {
        delete savedMetadata[serverId][resolvedTarget][key];
      }
      storage.metadata.save(savedMetadata);

      // Update channel metadata cache if this is for a channel
      if (ircClient.isChannel(serverId, resolvedTarget)) {
        const cache = state.channelMetadataCache[serverId] || {};
        const channelCache = cache[resolvedTarget] || { fetchedAt: Date.now() };

        if (key === "avatar") {
          channelCache.avatar = value || undefined;
        } else if (key === "display-name") {
          channelCache.displayName = value || undefined;
        }

        channelCache.fetchedAt = Date.now();

        const updatedCache = {
          ...state.channelMetadataCache,
          [serverId]: {
            ...cache,
            [resolvedTarget]: channelCache,
          },
        };

        // Remove from fetch queue
        const queue = state.channelMetadataFetchQueue[serverId];
        if (queue) {
          const newQueue = new Set(queue);
          newQueue.delete(resolvedTarget);

          return {
            servers: updatedServers,
            currentUser: updatedCurrentUser,
            channelMetadataCache: updatedCache,
            channelMetadataFetchQueue: {
              ...state.channelMetadataFetchQueue,
              [serverId]: newQueue,
            },
          };
        }

        return {
          servers: updatedServers,
          currentUser: updatedCurrentUser,
          channelMetadataCache: updatedCache,
        };
      }

      return {
        servers: updatedServers,
        currentUser: updatedCurrentUser,
        metadataChangeCounter: state.metadataChangeCounter + 1,
      };
    });
  });

  ircClient.on(
    "METADATA_KEYVALUE",
    ({ serverId, target, key, visibility, value }) => {
      // Handle individual key-value responses (similar to METADATA)
      store.setState((state) => {
        // Resolve the target - if it's "*", it refers to the current user
        const resolvedTarget =
          target === "*"
            ? ircClient.getNick(serverId) ||
              state.currentUser?.username ||
              target
            : target.split("!")[0]; // Extract nickname from mask

        let hasChanges = false;

        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            // Update metadata for users in channels
            const updatedChannels = server.channels.map((channel) => {
              const updatedUsers = channel.users.map((user) => {
                if (user.username === resolvedTarget) {
                  const existingValue = user.metadata?.[key]?.value;
                  const existingVisibility = user.metadata?.[key]?.visibility;

                  // Check if value actually changed
                  if (value !== null && value !== undefined && value !== "") {
                    if (
                      existingValue !== value ||
                      existingVisibility !== visibility
                    ) {
                      hasChanges = true;
                      const metadata = { ...(user.metadata || {}) };
                      metadata[key] = { value, visibility };
                      return { ...user, metadata };
                    }
                  } else {
                    // Deleting key
                    if (existingValue !== undefined) {
                      hasChanges = true;
                      const metadata = { ...(user.metadata || {}) };
                      delete metadata[key];
                      return { ...user, metadata };
                    }
                  }
                }
                return user;
              });

              // Update metadata for the channel itself if target matches channel name
              let updatedChannelMetadata = channel.metadata || {};
              if (resolvedTarget === channel.name) {
                const existingValue = updatedChannelMetadata[key]?.value;
                const existingVisibility =
                  updatedChannelMetadata[key]?.visibility;

                if (value !== null && value !== undefined && value !== "") {
                  if (
                    existingValue !== value ||
                    existingVisibility !== visibility
                  ) {
                    hasChanges = true;
                    updatedChannelMetadata = { ...updatedChannelMetadata };
                    updatedChannelMetadata[key] = { value, visibility };
                  }
                } else {
                  if (existingValue !== undefined) {
                    hasChanges = true;
                    updatedChannelMetadata = { ...updatedChannelMetadata };
                    delete updatedChannelMetadata[key];
                  }
                }
              }

              if (
                updatedUsers === channel.users &&
                updatedChannelMetadata === channel.metadata
              ) {
                return channel;
              }

              return {
                ...channel,
                users: updatedUsers,
                metadata: updatedChannelMetadata,
              };
            });

            if (updatedChannels === server.channels) {
              return server;
            }

            return {
              ...server,
              channels: updatedChannels,
            };
          }
          return server;
        });

        // Update current user metadata
        let updatedCurrentUser = state.currentUser;
        if (state.currentUser?.username === resolvedTarget) {
          const existingValue = state.currentUser.metadata?.[key]?.value;
          const existingVisibility =
            state.currentUser.metadata?.[key]?.visibility;

          if (value !== null && value !== undefined && value !== "") {
            if (existingValue !== value || existingVisibility !== visibility) {
              hasChanges = true;
              const metadata = { ...(state.currentUser.metadata || {}) };
              metadata[key] = { value, visibility };
              updatedCurrentUser = { ...state.currentUser, metadata };
            }
          } else {
            if (existingValue !== undefined) {
              hasChanges = true;
              const metadata = { ...(state.currentUser.metadata || {}) };
              delete metadata[key];
              updatedCurrentUser = { ...state.currentUser, metadata };
            }
          }
        }

        // Save valid metadata for any user, not just channel members.
        // Also marks hasChanges so metadataChangeCounter increments for DM re-renders.
        const savedMetadata = storage.metadata.load();
        if (value !== null && value !== undefined && value !== "") {
          if (!savedMetadata[serverId]) {
            savedMetadata[serverId] = {};
          }
          if (!savedMetadata[serverId][resolvedTarget]) {
            savedMetadata[serverId][resolvedTarget] = {};
          }
          if (savedMetadata[serverId][resolvedTarget][key]?.value !== value) {
            savedMetadata[serverId][resolvedTarget][key] = {
              value,
              visibility,
            };
            storage.metadata.save(savedMetadata);
            hasChanges = true;
          }
        } else if (savedMetadata[serverId]?.[resolvedTarget]?.[key]) {
          delete savedMetadata[serverId][resolvedTarget][key];
          storage.metadata.save(savedMetadata);
        }

        // Update channel metadata cache if this is for a channel
        if (ircClient.isChannel(serverId, resolvedTarget)) {
          const cache = state.channelMetadataCache[serverId] || {};
          const channelCache = cache[resolvedTarget] || {
            fetchedAt: Date.now(),
          };

          if (key === "avatar" && value) {
            channelCache.avatar = value;
          } else if (key === "display-name" && value) {
            channelCache.displayName = value;
          }

          channelCache.fetchedAt = Date.now();

          const updatedCache = {
            ...state.channelMetadataCache,
            [serverId]: {
              ...cache,
              [resolvedTarget]: channelCache,
            },
          };

          // Remove from fetch queue
          const queue = state.channelMetadataFetchQueue[serverId];
          if (queue) {
            const newQueue = new Set(queue);
            newQueue.delete(resolvedTarget);

            return {
              servers: updatedServers,
              currentUser: updatedCurrentUser,
              channelMetadataCache: updatedCache,
              channelMetadataFetchQueue: {
                ...state.channelMetadataFetchQueue,
                [serverId]: newQueue,
              },
              ...(hasChanges && {
                metadataChangeCounter: state.metadataChangeCounter + 1,
              }),
            };
          }

          return {
            servers: updatedServers,
            currentUser: updatedCurrentUser,
            channelMetadataCache: updatedCache,
            ...(hasChanges && {
              metadataChangeCounter: state.metadataChangeCounter + 1,
            }),
          };
        }

        // Only return new state if something actually changed
        if (
          !hasChanges &&
          updatedServers === state.servers &&
          updatedCurrentUser === state.currentUser
        ) {
          return {};
        }

        return {
          servers: updatedServers,
          currentUser: updatedCurrentUser,
          ...(hasChanges && {
            metadataChangeCounter: state.metadataChangeCounter + 1,
          }),
        };
      });
    },
  );

  ircClient.on("METADATA_KEYNOTSET", ({ serverId, target, key }) => {
    const state = store.getState();

    // Resolve the target - if it's "*", it refers to the current user
    const resolvedTarget =
      target === "*"
        ? ircClient.getNick(serverId) || state.currentUser?.username || target
        : target.split("!")[0]; // Extract nickname from mask

    const savedMetadata = storage.metadata.load();
    if (savedMetadata[serverId]?.[resolvedTarget]?.[key]) {
      delete savedMetadata[serverId][resolvedTarget][key];
      storage.metadata.save(savedMetadata);
    }

    // Handle key not set responses — only update state if the key actually exists
    store.setState((state) => {
      let anyChange = false;
      const updatedServers = state.servers.map((server) => {
        if (server.id !== serverId) return server;

        const updatedChannels = server.channels.map((channel) => {
          let usersChanged = false;
          const updatedUsers = channel.users.map((user) => {
            if (user.username !== resolvedTarget) return user;
            if (!user.metadata || !(key in user.metadata)) return user;
            const { [key]: _, ...rest } = user.metadata;
            usersChanged = true;
            return { ...user, metadata: rest };
          });

          const isChannelTarget = resolvedTarget === channel.name;
          const channelHasKey =
            isChannelTarget && channel.metadata && key in channel.metadata;

          if (!usersChanged && !channelHasKey) return channel;
          anyChange = true;

          const result = { ...channel };
          if (usersChanged) result.users = updatedUsers;
          if (channelHasKey && channel.metadata) {
            const { [key]: _, ...rest } = channel.metadata;
            result.metadata = rest;
          }
          return result;
        });

        if (!anyChange) return server;
        return { ...server, channels: updatedChannels };
      });

      // currentUser is a denormalized copy — update it separately from the servers loop
      let updatedCurrentUser = state.currentUser;
      if (
        state.currentUser?.metadata &&
        key in state.currentUser.metadata &&
        state.currentUser.username?.toLowerCase() ===
          resolvedTarget.toLowerCase()
      ) {
        const { [key]: _, ...rest } = state.currentUser.metadata;
        updatedCurrentUser = { ...state.currentUser, metadata: rest };
        anyChange = true;
      }

      let updatedChannelMetadataCache = state.channelMetadataCache;
      if (ircClient.isChannel(serverId, resolvedTarget)) {
        const serverCache = state.channelMetadataCache[serverId];
        if (serverCache?.[resolvedTarget]) {
          const channelCache = { ...serverCache[resolvedTarget] };
          if (key === "avatar") channelCache.avatar = undefined;
          else if (key === "display-name") channelCache.displayName = undefined;
          updatedChannelMetadataCache = {
            ...state.channelMetadataCache,
            [serverId]: { ...serverCache, [resolvedTarget]: channelCache },
          };
          anyChange = true;
        }
      }

      if (!anyChange) return {};
      return {
        servers: updatedServers,
        currentUser: updatedCurrentUser,
        channelMetadataCache: updatedChannelMetadataCache,
        metadataChangeCounter: state.metadataChangeCounter + 1,
      };
    });
  });

  ircClient.on("METADATA_SUBOK", ({ serverId, keys }) => {
    // Update subscriptions
    store.setState((state) => {
      const currentSubs = state.metadataSubscriptions[serverId] || [];
      const newSubs = [...new Set([...currentSubs, ...keys])];
      return {
        metadataSubscriptions: {
          ...state.metadataSubscriptions,
          [serverId]: newSubs,
        },
      };
    });
  });

  ircClient.on("METADATA_UNSUBOK", ({ serverId, keys }) => {
    // Update subscriptions
    store.setState((state) => {
      const currentSubs = state.metadataSubscriptions[serverId] || [];
      const newSubs = currentSubs.filter((k) => !keys.includes(k));
      return {
        metadataSubscriptions: {
          ...state.metadataSubscriptions,
          [serverId]: newSubs,
        },
      };
    });
  });

  ircClient.on("METADATA_SUBS", ({ serverId, keys }) => {
    // Set all subscriptions
    store.setState((state) => ({
      metadataSubscriptions: {
        ...state.metadataSubscriptions,
        [serverId]: keys,
      },
    }));
  });

  ircClient.on(
    "METADATA_FAIL",
    ({ serverId, subcommand, code, target, key, retryAfter }) => {
      // Handle metadata failures
      console.error(`Metadata ${subcommand} failed: ${code}`, {
        target,
        key,
        retryAfter,
      });
      // Could show user notifications here
    },
  );
}
