import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import { isChannelTarget } from "../../lib/ircUtils";
import type { AppState } from "../index";
import * as storage from "../localStorage";

// A server that still holds some of our metadata is the newest copy, since
// another of our clients may have changed it; one that holds none has
// forgotten us, so we set ours again.
export function syncOwnMetadata(
  store: StoreApi<AppState>,
  serverId: string,
  keys: string[],
): void {
  const ourNick = ircClient.getNick(serverId);
  if (!ourNick) return;
  const onServer = storage.metadata.load()[serverId]?.[ourNick] ?? {};
  const ours = storage.ownMetadata.load()[serverId] ?? {};
  const serverKept = Object.values(onServer).some((entry) => entry.value);
  for (const key of new Set([...keys, ...Object.keys(ours)])) {
    if (serverKept)
      storage.ownMetadata.remember(serverId, key, onServer[key]?.value);
    else if (ours[key])
      store.getState().metadataSet(serverId, "*", key, ours[key]);
  }
}

export function registerMetadataHandlers(store: StoreApi<AppState>): void {
  ircClient.on("rawLine", ({ serverId, direction, line }) => {
    if (direction !== "tx") return;
    const set = /^METADATA \* SET (\S+)(?: :(.*))?$/.exec(line);
    if (set) storage.ownMetadata.remember(serverId, set[1], set[2]);
  });

  ircClient.on("METADATA", ({ serverId, target, key, visibility, value }) => {
    if (target === "*" || target.split("!")[0] === ircClient.getNick(serverId))
      storage.ownMetadata.remember(serverId, key, value || undefined);
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
      if (isChannelTarget(resolvedTarget)) {
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
      const state = store.getState();
      const isFetchingOwn = state.metadataFetchInProgress[serverId];

      // Handle individual key-value responses (similar to METADATA)
      store.setState((state) => {
        // Resolve the target - if it's "*", it refers to the current user
        const resolvedTarget =
          target === "*"
            ? ircClient.getNick(serverId) ||
              state.currentUser?.username ||
              target
            : target.split("!")[0]; // Extract nickname from mask

        // If we're fetching our own metadata, update saved values
        if (isFetchingOwn && target === "*") {
          const savedMetadata = storage.metadata.load();
          if (!savedMetadata[serverId]) {
            savedMetadata[serverId] = {};
          }
          if (!savedMetadata[serverId][resolvedTarget]) {
            savedMetadata[serverId][resolvedTarget] = {};
          }
          // Only overwrite saved value with server value if server actually has a value
          // Empty/null values from server mean "not set", so keep our local value
          if (value !== null && value !== undefined && value !== "") {
            savedMetadata[serverId][resolvedTarget][key] = {
              value,
              visibility,
            };
            storage.metadata.save(savedMetadata);
          }
          // If server has the key but no value, and we have a local value, we'll send ours later
        }

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
                    if (
                      (!isFetchingOwn || target !== "*") &&
                      existingValue !== undefined
                    ) {
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
            if (
              (!isFetchingOwn || target !== "*") &&
              existingValue !== undefined
            ) {
              hasChanges = true;
              const metadata = { ...(state.currentUser.metadata || {}) };
              delete metadata[key];
              updatedCurrentUser = { ...state.currentUser, metadata };
            }
          }
        }

        // Save valid metadata for any user, not just channel members.
        // Also marks hasChanges so metadataChangeCounter increments for DM re-renders.
        if (!isFetchingOwn || target !== "*") {
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
            // Key was deleted on server — remove from localStorage too
            delete savedMetadata[serverId][resolvedTarget][key];
            storage.metadata.save(savedMetadata);
          }
        }

        // Update channel metadata cache if this is for a channel
        if (isChannelTarget(resolvedTarget)) {
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
    const isFetchingOwn = state.metadataFetchInProgress[serverId];

    // Resolve the target - if it's "*", it refers to the current user
    const resolvedTarget =
      target === "*"
        ? ircClient.getNick(serverId) || state.currentUser?.username || target
        : target.split("!")[0]; // Extract nickname from mask

    // Skip on reconnect GET responses — server lacking the key doesn't mean we should erase it;
    // the sync that follows will push our local copy back up.
    if (!isFetchingOwn) {
      const savedMetadata = storage.metadata.load();
      if (savedMetadata[serverId]?.[resolvedTarget]?.[key]) {
        delete savedMetadata[serverId][resolvedTarget][key];
        storage.metadata.save(savedMetadata);
      }
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
      if (isChannelTarget(resolvedTarget)) {
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
