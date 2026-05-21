import { t } from "@lingui/core/macro";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import { isChannelTarget } from "../../lib/ircUtils";
import type { Message } from "../../types";
import { resolveUserMetadata } from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";

function applyUserModeDelta(prev: string, delta: string): string {
  const currentModes = new Set(
    prev.replace(/[+-]/g, "").split("").filter(Boolean),
  );
  let adding = true;
  for (const char of delta) {
    if (char === "+") {
      adding = true;
      continue;
    }
    if (char === "-") {
      adding = false;
      continue;
    }
    if (adding) currentModes.add(char);
    else currentModes.delete(char);
  }
  return [...currentModes].sort().join("");
}

export function registerChannelHandlers(store: StoreApi<AppState>): void {
  ircClient.on("MODE", ({ serverId, sender, target, modestring, modeargs }) => {
    // Channel modes are handled via RPL_CHANNELMODEIS (324); only handle user modes here
    if (!isChannelTarget(target)) {
      store.setState((state) => {
        const currentUser = state.currentUser;
        if (
          currentUser &&
          currentUser.username.toLowerCase() === target.toLowerCase()
        ) {
          const nextModes = applyUserModeDelta(
            currentUser.modes || "",
            modestring,
          );
          return {
            currentUser: {
              ...currentUser,
              modes: nextModes,
              isIrcOp: nextModes.includes("o"),
            },
          };
        }

        const ircCurrentUser = ircClient.getCurrentUser(serverId);
        if (
          !currentUser &&
          ircCurrentUser &&
          ircCurrentUser.username.toLowerCase() === target.toLowerCase()
        ) {
          const nextModes = applyUserModeDelta(
            ircCurrentUser.modes || "",
            modestring,
          );
          return {
            currentUser: {
              ...ircCurrentUser,
              modes: nextModes,
              isIrcOp: nextModes.includes("o"),
            },
          };
        }

        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedUsers = server.users.map((user) => {
              if (user.username.toLowerCase() === target.toLowerCase()) {
                return {
                  ...user,
                  modes: applyUserModeDelta(user.modes || "", modestring),
                };
              }
              return user;
            });
            return { ...server, users: updatedUsers };
          }
          return server;
        });

        return { servers: updatedServers };
      });
    }
  });

  ircClient.on(
    "RPL_CHANNELMODEIS",
    ({ serverId, channelName, modestring, modeargs }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((channel) => {
              if (channel.name.toLowerCase() === channelName.toLowerCase()) {
                return { ...channel, modes: modestring, modeArgs: modeargs };
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

  ircClient.on(
    "RPL_BANLIST",
    ({ serverId, channel, mask, setter, timestamp }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((ch) => {
              if (ch.name === channel) {
                const bans = ch.bans ?? [];
                return {
                  ...ch,
                  bans: bans.some((ban) => ban.mask === mask)
                    ? bans
                    : [...bans, { mask, setter, timestamp }],
                };
              }
              return ch;
            });
            return { ...server, channels: updatedChannels };
          }
          return server;
        });
        return { servers: updatedServers };
      });
    },
  );

  ircClient.on(
    "RPL_INVITELIST",
    ({ serverId, channel, mask, setter, timestamp }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((ch) => {
              if (ch.name === channel) {
                const invites = ch.invites ?? [];
                return {
                  ...ch,
                  invites: invites.some((invite) => invite.mask === mask)
                    ? invites
                    : [...invites, { mask, setter, timestamp }],
                };
              }
              return ch;
            });
            return { ...server, channels: updatedChannels };
          }
          return server;
        });
        return { servers: updatedServers };
      });
    },
  );

  ircClient.on(
    "RPL_EXCEPTLIST",
    ({ serverId, channel, mask, setter, timestamp }) => {
      store.setState((state) => {
        const updatedServers = state.servers.map((server) => {
          if (server.id === serverId) {
            const updatedChannels = server.channels.map((ch) => {
              if (ch.name === channel) {
                const exceptions = ch.exceptions ?? [];
                return {
                  ...ch,
                  exceptions: exceptions.some(
                    (exception) => exception.mask === mask,
                  )
                    ? exceptions
                    : [...exceptions, { mask, setter, timestamp }],
                };
              }
              return ch;
            });
            return { ...server, channels: updatedChannels };
          }
          return server;
        });
        return { servers: updatedServers };
      });
    },
  );

  ircClient.on("RPL_ENDOFBANLIST", () => {});

  ircClient.on("RPL_ENDOFINVITELIST", () => {});

  ircClient.on("RPL_YOUREOPER", ({ serverId, message }) => {
    // Show notification that user is now an IRC operator
    store.getState().addGlobalNotification({
      type: "note",
      command: "Oper",
      code: "OPER",
      message: t`You are an IRC Operator`,
      serverId,
    });
  });

  ircClient.on("RPL_YOURHOST", ({ serverId, serverName, version }) => {
    // The `isUnrealIRCd` flag gates UI surfaces that lean on the
    // UnrealIRCd module-driven chanmode set (the "Advanced" tab in
    // ChannelSettingsModal, etc.). ObbyIRCd is a downstream fork that
    // advertises its own name in 002 but inherits that chanmode set,
    // so it satisfies the same UI gate. Any features ObbyIRCd adds on
    // top (e.g. named-modes) are detected separately through their
    // own caps and shouldn't be conflated with UnrealIRCd parity.
    const isUnrealIRCd =
      version.includes("UnrealIRCd") || version.includes("ObbyIRCd");

    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId ? { ...server, isUnrealIRCd } : server,
      ),
    }));
  });

  // Topic handlers
  ircClient.on("TOPIC", ({ serverId, channelName, topic, sender }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            if (channel.name.toLowerCase() === channelName.toLowerCase()) {
              return { ...channel, topic };
            }
            return channel;
          });
          return { ...server, channels: updatedChannels };
        }
        return server;
      });
      return { servers: updatedServers };
    });

    // Optionally add a system message showing the topic change
    const server = store.getState().servers.find((s) => s.id === serverId);
    const channel = server?.channels.find((c) => c.name === channelName);
    if (channel) {
      const topicMessage: Message = {
        id: `topic-${Date.now()}`,
        channelId: channel.id,
        userId: sender,
        content: t`changed the topic to: ${topic}`,
        timestamp: new Date(),
        serverId: serverId,
        reactions: [],
        type: "system",
        replyMessage: null,
        mentioned: [],
      };

      const key = `${serverId}-${channel.id}`;
      store.setState((state) => ({
        messages: {
          ...state.messages,
          [key]: [...(state.messages[key] || []), topicMessage],
        },
      }));
    }
  });

  ircClient.on("RPL_TOPIC", ({ serverId, channelName, topic }) => {
    // Skip entirely when the topic hasn't changed — servers.map() always returns a new
    // array reference, so calling setState unconditionally floods React with no-op updates.
    const existing = store
      .getState()
      .servers.find((s) => s.id === serverId)
      ?.channels.find(
        (ch) => ch.name.toLowerCase() === channelName.toLowerCase(),
      );
    if (existing?.topic === topic) return;

    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            if (channel.name.toLowerCase() === channelName.toLowerCase()) {
              return { ...channel, topic };
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

  ircClient.on(
    "RPL_TOPICWHOTIME",
    ({ serverId, channelName, setter, timestamp }) => {},
  );

  ircClient.on("RPL_NOTOPIC", ({ serverId, channelName }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            if (channel.name.toLowerCase() === channelName.toLowerCase()) {
              return { ...channel, topic: undefined };
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

  ircClient.on("LIST_CHANNEL", ({ serverId, channel, userCount, topic }) => {
    store.setState((state) => {
      if (!state.listingInProgress[serverId]) {
        // Not currently listing, ignore
        return {};
      }
      const currentBuffer = state.channelListBuffer[serverId] || [];
      const updatedBuffer = [...currentBuffer, { channel, userCount, topic }];
      return {
        channelListBuffer: {
          ...state.channelListBuffer,
          [serverId]: updatedBuffer,
        },
      };
    });
  });

  ircClient.on("LIST_END", ({ serverId }) => {
    // Move buffered channels to the main list and set listing as complete
    store.setState((state) => ({
      channelList: {
        ...state.channelList,
        [serverId]: state.channelListBuffer[serverId] || [],
      },
      channelListBuffer: {
        ...state.channelListBuffer,
        [serverId]: [],
      },
      listingInProgress: {
        ...state.listingInProgress,
        [serverId]: false,
      },
    }));
  });

  ircClient.on("NAMES", ({ serverId, channelName, users }) => {
    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((channel) => {
            if (channel.name.toLowerCase() === channelName.toLowerCase()) {
              // Add users from NAMES reply to the channel
              const existingUsernames = new Set(
                channel.users.map((u) => u.username.toLowerCase()),
              );

              // Load once for the whole NAMES batch — not per user
              const savedMetadata = storage.metadata.load();
              const serverMetadata = savedMetadata[serverId];

              const newUsers = users
                .filter(
                  (user) => !existingUsernames.has(user.username.toLowerCase()),
                )
                .map((user) => ({
                  ...user,
                  id: uuidv4(),
                  isOnline: true,
                  metadata: resolveUserMetadata(
                    user.username,
                    serverMetadata,
                    server.channels,
                    channelName,
                  ),
                }));

              return {
                ...channel,
                users: [...channel.users, ...newUsers],
              };
            }
            return channel;
          });

          return {
            ...server,
            channels: updatedChannels,
          };
        }
        return server;
      });
      
      // Check if current user has operator status in this channel and update their modes
      const currentUser = state.currentUser;
      if (currentUser) {
        const currentUserInChannel = users.find(
          (user) =>
            user.username.toLowerCase() === currentUser.username.toLowerCase(),
        );
        if (currentUserInChannel?.status) {
          // Check if user has operator status (contains '@' or other operator prefixes)
          const hasOperatorStatus =
            currentUserInChannel.status.includes("@") ||
            currentUserInChannel.status.includes("~") ||
            currentUserInChannel.status.includes("&");
          if (hasOperatorStatus && !currentUser.modes?.includes("o")) {
            // Update currentUser with operator modes
            return {
              servers: updatedServers,
              currentUser: {
                ...currentUser,
                modes: currentUser.modes ? `${currentUser.modes}o` : "o",
              },
            };
          }
        }
      }

      return { servers: updatedServers };
    });
  });
}
