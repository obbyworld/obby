import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { User } from "../../types";
import { serverSupportsMetadata } from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";

export function registerWhoisHandlers(store: StoreApi<AppState>): void {
  // WHOIS event handlers
  ircClient.on("WHOIS_USER", ({ serverId, nick, username, host, realname }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              username,
              host,
              realname,
              timestamp: Date.now(),
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_SERVER", ({ serverId, nick, server, serverInfo }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              server,
              serverInfo,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_IDLE", ({ serverId, nick, idle, signon }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              idle,
              signon,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_CHANNELS", ({ serverId, nick, channels }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              channels,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_ACCOUNT", ({ serverId, nick, account }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              account,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_MODES", ({ serverId, nick, umodes, snomask }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existing = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };
      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existing,
              umodes,
              snomask: snomask || undefined,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_SECURE", ({ serverId, nick, message }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              secureConnection: message,
            },
          },
        },
      };
    });
  });

  ircClient.on("WHOIS_SPECIAL", ({ serverId, nick, message }) => {
    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick] || {
        nick,
        specialMessages: [],
        timestamp: Date.now(),
      };

      // Deduplicate special messages
      const updatedMessages = existingData.specialMessages.includes(message)
        ? existingData.specialMessages
        : [...existingData.specialMessages, message];

      return {
        whoisData: {
          ...state.whoisData,
          [serverId]: {
            ...serverWhois,
            [nick]: {
              ...existingData,
              specialMessages: updatedMessages,
            },
          },
        },
      };
    });
  });

  // Fires when an obby.world/whois parent batch closes. Merges the
  // assembled per-session detail + session-count summary into the
  // existing WhoisData entry. The legacy per-numeric handlers above
  // have already filled the account-level fields; this only adds the
  // multi-session-specific bits.
  ircClient.on(
    "OBBY_WHOIS_COMPLETE",
    ({ serverId, nick, sessions, sessionCount }) => {
      store.setState((state) => {
        const serverWhois = state.whoisData[serverId] || {};
        const existingData = serverWhois[nick] || {
          nick,
          specialMessages: [],
          timestamp: Date.now(),
        };
        return {
          whoisData: {
            ...state.whoisData,
            [serverId]: {
              ...serverWhois,
              [nick]: {
                ...existingData,
                sessions: sessions.length > 0 ? sessions : undefined,
                sessionCount:
                  sessionCount !== undefined
                    ? sessionCount
                    : sessions.length > 0
                      ? sessions.length
                      : undefined,
              },
            },
          },
        };
      });
    },
  );

  ircClient.on("WHOIS_END", ({ serverId, nick }) => {
    // Mark the whois data as complete
    console.log(`WHOIS completed for ${nick} on server ${serverId}`);

    store.setState((state) => {
      const serverWhois = state.whoisData[serverId] || {};
      const existingData = serverWhois[nick];

      if (existingData) {
        return {
          whoisData: {
            ...state.whoisData,
            [serverId]: {
              ...serverWhois,
              [nick]: {
                ...existingData,
                isComplete: true,
              },
            },
          },
        };
      }

      return state;
    });
  });

  ircClient.on("WHOIS_BOT", ({ serverId, target }) => {
    // Update user objects in channels
    store.setState((state) => {
      let hasChanges = false;
      const updatedServers = state.servers.map((s) => {
        if (s.id === serverId) {
          const updatedChannels = s.channels.map((channel) => {
            const updatedUsers = channel.users.map((user) => {
              if (user.username === target && !user.isBot) {
                hasChanges = true;
                return {
                  ...user,
                  isBot: true,
                  metadata: {
                    ...user.metadata,
                    bot: user.metadata?.bot || {
                      value: "true",
                      visibility: "public",
                    },
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

      if (!hasChanges || updatedServers === state.servers) {
        return {};
      }

      return { servers: updatedServers };
    });
  });

  ircClient.on(
    "WHO_REPLY",
    ({
      serverId,
      channel,
      username,
      host,
      server,
      nick,
      flags,
      hopcount,
      realname,
    }) => {
      const state = store.getState();
      const serverData = state.servers.find((s) => s.id === serverId);
      if (!serverData) return;

      // Parse away status from flags (e.g., "H@" means here and operator, "G" means gone/away)
      let isAway = false;
      if (flags) {
        // First character indicates here (H) or gone/away (G)
        if (flags[0] === "G") {
          isAway = true;
        } else if (flags[0] === "H") {
          isAway = false;
        }
      }

      // If channel is "*", this is a user-specific WHO query (e.g., "WHO username")
      // Update private chats only in this case
      if (channel === "*") {
        store.setState((state) => {
          const updatedServers = state.servers.map((s) => {
            if (s.id === serverId) {
              const updatedPrivateChats = s.privateChats?.map((pm) => {
                if (pm.username.toLowerCase() === nick.toLowerCase()) {
                  // If user is away and this is a pinned PM, send WHOIS to get away message
                  if (isAway && pm.isPinned) {
                    setTimeout(() => {
                      ircClient.sendRaw(serverId, `WHOIS ${nick}`);
                    }, 100);
                  }

                  return {
                    ...pm,
                    isOnline: true,
                    isAway: isAway,
                    // Correct stored username to server-authoritative casing
                    username: nick,
                  };
                }
                return pm;
              });

              return {
                ...s,
                privateChats: updatedPrivateChats,
              };
            }
            return s;
          });

          return { servers: updatedServers };
        });
        return; // Don't process channel user list for user-specific queries
      }

      // Find the channel this WHO reply belongs to
      const channelData = serverData.channels.find((c) => c.name === channel);
      if (!channelData) {
        return;
      }

      // Parse channel status from flags (e.g., "@" means operator)
      let channelStatus = "";

      if (flags) {
        // Extract channel status prefixes from flags
        const statusChars = flags.match(/[~&@%+]/g);
        if (statusChars) {
          channelStatus = statusChars.join("");
        }
      }

      // Create user object from WHO data with proper User type
      const user: User = {
        id: nick,
        username: nick,
        hostname: host, // Store the hostname from WHO reply
        realname: realname, // Store the realname/gecos from WHO reply
        avatar: undefined,
        isOnline: true,
        isAway: isAway,
        isBot: false,
        isIrcOp: flags ? flags.includes("*") : false, // Check for IRC operator flag
        status: channelStatus, // Set the channel status here
        metadata: {},
      };
      // Check for bot flags if bot mode is enabled
      if (serverData.botMode) {
        const botFlag = serverData.botMode;
        const isBot = flags.includes(botFlag);

        if (isBot) {
          user.isBot = true;
          user.metadata = {
            bot: { value: "true", visibility: "public" },
          };
        }
      }

      // Load saved metadata for this user from localStorage
      const savedMetadata = storage.metadata.load();
      if (savedMetadata[serverId]?.[nick]) {
        user.metadata = {
          ...user.metadata,
          ...savedMetadata[serverId][nick],
        };
      }

      // Update the channel's user list with this user
      store.setState((state) => {
        const updatedServers = state.servers.map((s) => {
          if (s.id === serverId) {
            // Update channels
            const updatedChannels = s.channels.map((ch) => {
              if (ch.name === channel) {
                // Check if user already exists in the list
                const existingUserIndex = ch.users.findIndex(
                  (u) => u.username === nick,
                );

                if (existingUserIndex !== -1) {
                  // Update existing user
                  const updatedUsers = [...ch.users];
                  updatedUsers[existingUserIndex] = {
                    ...updatedUsers[existingUserIndex],
                    ...user,
                    metadata: {
                      ...updatedUsers[existingUserIndex].metadata,
                      ...user.metadata,
                    },
                  };
                  return { ...ch, users: updatedUsers };
                }
                // Add new user
                return { ...ch, users: [...ch.users, user] };
              }
              return ch;
            });

            // Also update private chats if this user has a PM tab open
            const updatedPrivateChats = s.privateChats.map((pm) => {
              if (pm.username.toLowerCase() === nick.toLowerCase()) {
                // Update the PM tab with realname from WHO
                return {
                  ...pm,
                  realname: realname,
                };
              }
              return pm;
            });

            return {
              ...s,
              channels: updatedChannels,
              privateChats: updatedPrivateChats,
            };
          }
          return s;
        });

        return { servers: updatedServers };
      });
    },
  );

  ircClient.on("WHO_END", ({ serverId, mask }) => {
    // When WHO list is complete for a channel, request metadata for all users
    // This ensures we get current metadata for users who were already in the channel
    const state = store.getState();
    const serverData = state.servers.find((s) => s.id === serverId);
    if (!serverData) return;

    // Find the channel (mask should be the channel name)
    const channelData = serverData.channels.find((c) => c.name === mask);

    if (channelData) {
      // This was a WHO for a channel
      // Only request metadata if server supports it
      if (serverSupportsMetadata(state, serverId)) {
        // Request metadata for all users in the channel
        channelData.users.forEach((user) => {
          // Only request if we don't already have metadata for this user
          const hasMetadata =
            user.metadata && Object.keys(user.metadata).length > 0;
          if (!hasMetadata) {
            store.getState().metadataList(serverId, user.username);
          }
        });
      }
    } else {
      // This might be a WHO for an individual user (private chat)
      // If we got no WHO_REPLY before this WHO_END, the user is offline
      const privateChat = serverData.privateChats?.find(
        (pm) => pm.username.toLowerCase() === mask.toLowerCase(),
      );

      if (privateChat) {
        // Check if we got a WHO_REPLY for this user by checking their online status
        // If they're still marked as offline after WHO_END, they're truly offline
        store.setState((state) => {
          const updatedServers = state.servers.map((s) => {
            if (s.id === serverId) {
              const updatedPrivateChats = s.privateChats?.map((pm) => {
                if (pm.username.toLowerCase() === mask.toLowerCase()) {
                  // If no WHO_REPLY was received, isOnline would still be false
                  // Keep it that way and mark as not away
                  if (!pm.isOnline) {
                    return { ...pm, isOnline: false, isAway: false };
                  }
                }
                return pm;
              });
              return { ...s, privateChats: updatedPrivateChats };
            }
            return s;
          });
          return { servers: updatedServers };
        });
      }
    }
  });

  // WHOX reply handler - for WHO responses with account information
  ircClient.on(
    "WHOX_REPLY",
    ({
      serverId,
      channel,
      username,
      host,
      nick,
      account,
      flags,
      realname,
      isAway,
      opLevel,
    }) => {
      const state = store.getState();
      const serverData = state.servers.find((s) => s.id === serverId);
      if (!serverData) return;

      // Determine flags once
      const isBotFromFlags = flags.includes("B");
      const isIrcOpFromFlags = flags.includes("*");
      const accountValue = account === "0" ? undefined : account;

      store.setState((state) => {
        const updatedServers = state.servers.map((s) => {
          if (s.id === serverId) {
            let updatedPrivateChats = s.privateChats || [];
            let updatedChannels = s.channels;

            // Update private chat with account and realname information
            const privateChatIndex = updatedPrivateChats.findIndex(
              (pm) => pm.username.toLowerCase() === nick.toLowerCase(),
            );
            if (privateChatIndex !== -1) {
              const existingPm = updatedPrivateChats[privateChatIndex];
              const isBot = existingPm.isBot || isBotFromFlags;

              // Only update if something actually changed
              if (
                existingPm.realname !== realname ||
                existingPm.account !== accountValue ||
                existingPm.isOnline !== true ||
                existingPm.isAway !== isAway ||
                existingPm.isBot !== isBot ||
                existingPm.isIrcOp !== isIrcOpFromFlags
              ) {
                updatedPrivateChats = [...updatedPrivateChats];
                updatedPrivateChats[privateChatIndex] = {
                  ...existingPm,
                  username: nick, // Correct to server-authoritative casing
                  realname: realname,
                  account: accountValue,
                  isOnline: true,
                  isAway: isAway,
                  isBot: isBot,
                  isIrcOp: isIrcOpFromFlags,
                };
              }
            }

            // Update/add channel users from WHOX response
            updatedChannels = updatedChannels.map((ch) => {
              // Only update the specific channel from the WHOX response
              if (ch.name === channel) {
                // Check if user already exists in this channel
                const existingUserIndex = ch.users.findIndex(
                  (user) => user.username.toLowerCase() === nick.toLowerCase(),
                );

                if (existingUserIndex !== -1) {
                  // Update existing user
                  const existingUser = ch.users[existingUserIndex];
                  const isBot = existingUser.isBot || isBotFromFlags;

                  // Only update if something actually changed
                  if (
                    existingUser.hostname !== host ||
                    existingUser.realname !== realname ||
                    existingUser.account !== accountValue ||
                    existingUser.isAway !== isAway ||
                    existingUser.isBot !== isBot ||
                    existingUser.isIrcOp !== isIrcOpFromFlags ||
                    existingUser.status !== (opLevel || existingUser.status)
                  ) {
                    const updatedUsers = [...ch.users];
                    updatedUsers[existingUserIndex] = {
                      ...existingUser,
                      hostname: host,
                      realname: realname,
                      account: accountValue,
                      isAway: isAway,
                      isBot: isBot,
                      isIrcOp: isIrcOpFromFlags,
                      status: opLevel || existingUser.status,
                    };
                    return { ...ch, users: updatedUsers };
                  }
                } else {
                  // Add new user to channel
                  const savedMeta = storage.metadata.load();
                  const newUser: User = {
                    id: `${nick}-${serverId}`,
                    username: nick,
                    hostname: host,
                    realname: realname,
                    account: accountValue,
                    isOnline: true,
                    isAway: isAway,
                    isBot: isBotFromFlags,
                    isIrcOp: isIrcOpFromFlags,
                    status: opLevel,
                    metadata: { ...(savedMeta[serverId]?.[nick] ?? {}) },
                  };
                  return { ...ch, users: [...ch.users, newUser] };
                }
              }
              return ch;
            });

            // Only return new server object if something actually changed
            if (
              updatedPrivateChats === s.privateChats &&
              updatedChannels === s.channels
            ) {
              return s;
            }

            return {
              ...s,
              privateChats: updatedPrivateChats,
              channels: updatedChannels,
            };
          }
          return s;
        });
        // No-op if every server reference is unchanged — servers.map() always produces
        // a new array, so without this guard every WHOX reply causes a re-render even
        // when all user data was already current, triggering maximum-update-depth warnings.
        if (updatedServers.every((s, i) => s === state.servers[i]))
          return state;
        return { servers: updatedServers };
      });

      // Update currentUser if this WHOX reply is for the current user
      // NOTE: We parse IRC op flags from WHO responses about ourselves for logging,
      // but don't update our own state from WHO replies - that should come from MODE events
      const currentUser = state.currentUser;
      if (
        currentUser &&
        currentUser.username.toLowerCase() === nick.toLowerCase()
      ) {
        // Don't update currentUser from WHO replies - only from authoritative MODE events
        return;
      }

      // If user is away and we have a pinned PM with them, send WHOIS to get away message
      const privateChat = serverData.privateChats?.find(
        (pm) => pm.username.toLowerCase() === nick.toLowerCase() && pm.isPinned,
      );

      if (isAway && privateChat) {
        // Send WHOIS to get the away message
        setTimeout(() => {
          ircClient.sendRaw(serverId, `WHOIS ${nick}`);
        }, 50);
      }
    },
  );
}
