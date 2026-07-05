/**
 * draft/bot-cmds plumbing:
 *  - subscribes to TAGMSGs that carry +draft/bot-cmds (response to a
 *    +draft/bot-cmds-query) and caches the decoded schema on the
 *    server's `botCommands` map keyed by bot nick (lowercased)
 *  - subscribes to +draft/bot-cmds-changed and clears the cached
 *    schema for that bot so the next slash invocation re-queries
 *  - exposes a tiny `queryBotCommands(serverId, botNick)` helper
 *    used by ChatArea on JOIN to seed the cache for any +B users
 *    we now share a channel with
 */
import type { StoreApi } from "zustand";
import { base64DecodeUtf8 } from "../../lib/base64";
import ircClient from "../../lib/ircClient";
import {
  botCanRegisterPrivileged,
  PRIVILEGED_COMMANDS,
} from "../../lib/privilegedCommands";
import type { BotCommand, PushBotInfo } from "../../types";
import useStore, { type AppState } from "../index";

function decodeB64Json(value: string): unknown | null {
  try {
    return JSON.parse(base64DecodeUtf8(value));
  } catch (e) {
    console.warn("[pushbot] base64-JSON decode failed", e);
    return null;
  }
}

function decodeBotCmds(value: string): BotCommand[] | null {
  const parsed = decodeB64Json(value);
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { commands?: unknown }).commands)
  ) {
    return (parsed as { commands: BotCommand[] }).commands;
  }
  return null;
}

function decodeBotInfo(value: string): PushBotInfo | null {
  const parsed = decodeB64Json(value);
  if (parsed && typeof parsed === "object" && (parsed as PushBotInfo).nick) {
    return parsed as PushBotInfo;
  }
  return null;
}

type BotCmdsFragments = { sender: string; fragments: string[] };
const botCmdsBatches = new Map<string, BotCmdsFragments>();

function commitBotCmds(
  store: StoreApi<AppState>,
  serverId: string,
  senderNick: string,
  cmds: BotCommand[],
): void {
  const key = senderNick.toLowerCase();
  // Don't cache a +draft/bot-cmds payload unless we have independent
  // evidence the sender is actually a bot: either a server-pushed
  // entry in s.bots (only the IRCd can emit that) or a +B WHO flag
  // in a channel we share. Otherwise any nick can ship a forged
  // payload that shadows real bot commands at slash-dispatch time.
  const initialState = store.getState();
  const initialServer = initialState.servers.find((s) => s.id === serverId);
  if (initialServer) {
    const knownBot = initialServer.bots?.[key];
    const seenAsBot =
      knownBot !== undefined ||
      initialServer.channels.some((c) =>
        c.users.some(
          (u) => u.username.toLowerCase() === key && u.isBot === true,
        ),
      );
    if (!seenAsBot) {
      console.warn(
        "[pushbot] dropping +draft/bot-cmds from non-bot sender",
        senderNick,
      );
      return;
    }
  }
  store.setState((state) => ({
    servers: state.servers.map((s) => {
      if (s.id !== serverId) return s;
      const existingBot = s.bots?.[key];
      // Strip privileged command names unless this bot is config-defined.
      // A channel bot publishing `oper` or `identify` in its schema is a
      // credential-capture trap; the slash picker should never even show
      // those entries for a self-registered bot.  See the bot-tools spec
      // security-considerations note on shadowing privileged names.
      const filteredCmds = botCanRegisterPrivileged(existingBot)
        ? cmds
        : cmds.filter((c) => {
            if (PRIVILEGED_COMMANDS.has(c.name.toLowerCase())) {
              console.warn(
                "[pushbot] dropping privileged command from non-config bot",
                { bot: senderNick, cmd: c.name },
              );
              return false;
            }
            return true;
          });
      const sharedChannels = s.channels
        .filter((c) => c.users.some((u) => u.username.toLowerCase() === key))
        .map((c) => c.name);
      const synthesisedBot: PushBotInfo = existingBot ?? {
        bot_id: `draft-bot-cmds:${key}`,
        nick: senderNick,
        realname: "",
        scope: "channel",
        transport: "gateway",
        status: "active",
        online: true,
        from_config: false,
        channels: sharedChannels,
        commands: filteredCmds,
      };
      return {
        ...s,
        botCommands: { ...(s.botCommands ?? {}), [key]: filteredCmds },
        bots: {
          ...(s.bots ?? {}),
          [key]: existingBot
            ? { ...existingBot, commands: filteredCmds }
            : {
                ...synthesisedBot,
                channels: sharedChannels,
                commands: filteredCmds,
              },
        },
      };
    }),
  }));
}

export function registerPushBotHandlers(store: StoreApi<AppState>): void {
  // When WHO completes for a channel, pre-fetch slash-command schemas
  // for any +B users we now share a channel with so the autocomplete
  // cache is warm by the time the user types '/'.
  // When a bot joins a channel we're in, query its commands so the
  // slash picker / bots modal stays current without waiting for the
  // user to type '/'.  We don't yet know if the joiner is +B at this
  // moment -- WHO hasn't run -- so query unconditionally and let the
  // bot's own discovery-noop semantics (regular users don't reply)
  // sort it out.  Skip ourselves.
  ircClient.on("JOIN", ({ serverId, username, channelName, batchTag }) => {
    if (batchTag) return;
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;
    const myNick = ircClient.getCurrentUser(serverId)?.username;
    if (myNick && username.toLowerCase() === myNick.toLowerCase()) return;
    if (server.botCommands?.[username.toLowerCase()]) return;
    queryBotCommands(serverId, username);
  });

  ircClient.on("WHO_END", ({ serverId, mask }) => {
    if (!mask?.startsWith("#")) return;
    const server = store.getState().servers.find((s) => s.id === serverId);
    if (!server) return;
    const channel = server.channels.find(
      (c) => c.name.toLowerCase() === mask.toLowerCase(),
    );
    if (!channel) return;
    const cache = server.botCommands ?? {};
    for (const u of channel.users) {
      if (!u.isBot) continue;
      const key = u.username.toLowerCase();
      if (cache[key]) continue;
      queryBotCommands(serverId, u.username);
    }
  });

  ircClient.on("TAGMSG", (response) => {
    const { serverId, sender, mtags } = response;
    if (!mtags) return;

    // obby.world/bot-info: server-pushed bot directory entries
    // (initial burst + per-bot 'add'/'update'/'remove' events).
    // These arrive from the server itself, not from a bot.
    if (mtags["obby.world/bot-info"]) {
      const info = decodeBotInfo(mtags["obby.world/bot-info"]);
      if (!info) return;
      const event = info.commands === undefined ? "remove" : "add";
      const evField = (info as unknown as { event?: string }).event ?? event;
      const nickKey = info.nick.toLowerCase();
      store.setState((state) => ({
        servers: state.servers.map((s) => {
          if (s.id !== serverId) return s;
          const next = { ...(s.bots ?? {}) };
          if (evField === "remove") {
            delete next[nickKey];
          } else {
            next[nickKey] = info;
          }
          // Keep botCommands in sync so the slash popover picks it up
          // without a separate +draft/bot-cmds-query.
          const cmds = { ...(s.botCommands ?? {}) };
          if (evField === "remove") {
            delete cmds[nickKey];
          } else if (Array.isArray(info.commands)) {
            cmds[nickKey] = info.commands;
          }
          return { ...s, bots: next, botCommands: cmds };
        }),
      }));
      return;
    }

    const botNick = (sender || "").toLowerCase();
    if (!botNick) return;

    if (mtags["+draft/bot-cmds"]) {
      const batchRef = mtags.batch;
      if (batchRef) {
        // A batched fragment.  If we're tracking the batch (saw the
        // BATCH +<ref> draft/bot-cmds open this session) append the
        // chunk; otherwise drop silently -- almost certainly a
        // chathistory replay of an old batch whose start the server
        // doesn't redeliver, and trying to decode the partial base64
        // as its own JSON just spams the console.
        botCmdsBatches
          .get(`${serverId}:${batchRef}`)
          ?.fragments.push(mtags["+draft/bot-cmds"]);
        return;
      }
      // Single-shot (small command list, no BATCH wrapper).
      const cmds = decodeBotCmds(mtags["+draft/bot-cmds"]);
      if (cmds) commitBotCmds(store, serverId, sender, cmds);
      return;
    }

    if (mtags["+draft/bot-cmds-changed"]) {
      store.setState((state) => ({
        servers: state.servers.map((s) => {
          if (s.id !== serverId || !s.botCommands) return s;
          if (!(botNick in s.botCommands)) return s;
          const next = { ...s.botCommands };
          delete next[botNick];
          return { ...s, botCommands: next };
        }),
      }));
      // refetch on next slash invocation; UI doesn't need a proactive query
    }
  });

  ircClient.on("BATCH_START", ({ serverId, batchId, type, sender }) => {
    if (type !== "draft/bot-cmds") return;
    console.log("[bot-cmds] BATCH start", { batchId, sender });
    botCmdsBatches.set(`${serverId}:${batchId}`, {
      sender: sender ?? "",
      fragments: [],
    });
    if (sender) {
      const key = sender.toLowerCase();
      store.setState((state) => ({
        servers: state.servers.map((s) => {
          if (s.id !== serverId) return s;
          const current = s.botCommandsLoading ?? [];
          const loadingNext = current.includes(key)
            ? current
            : [...current, key];
          // Insert a placeholder PushBotInfo so the modal renders this
          // bot as a row immediately, with the spinner from
          // botCommandsLoading. Real commands replace it on BATCH_END.
          const sharedChannels = s.channels
            .filter((c) =>
              c.users.some((u) => u.username.toLowerCase() === key),
            )
            .map((c) => c.name);
          const existingBot = s.bots?.[key];
          const botsNext = existingBot
            ? s.bots
            : {
                ...(s.bots ?? {}),
                [key]: {
                  bot_id: `draft-bot-cmds:${key}`,
                  nick: sender,
                  realname: "",
                  scope: "channel",
                  transport: "gateway",
                  status: "active",
                  online: true,
                  from_config: false,
                  channels: sharedChannels,
                  commands: [],
                } satisfies PushBotInfo,
              };
          return { ...s, botCommandsLoading: loadingNext, bots: botsNext };
        }),
      }));
    }
  });

  ircClient.on("BATCH_END", ({ serverId, batchId }) => {
    const key = `${serverId}:${batchId}`;
    const entry = botCmdsBatches.get(key);
    if (!entry) return;
    botCmdsBatches.delete(key);
    if (entry.sender) {
      const nickKey = entry.sender.toLowerCase();
      store.setState((state) => ({
        servers: state.servers.map((s) => {
          if (s.id !== serverId || !s.botCommandsLoading) return s;
          const next = s.botCommandsLoading.filter((n) => n !== nickKey);
          return { ...s, botCommandsLoading: next };
        }),
      }));
    }
    const joined = entry.fragments.join("");
    console.log("[bot-cmds] BATCH end", {
      batchId,
      sender: entry.sender,
      fragments: entry.fragments.length,
      joinedLength: joined.length,
    });
    if (!entry.fragments.length) return;
    const cmds = decodeBotCmds(joined);
    if (cmds) {
      console.log("[bot-cmds] decoded ok", { count: cmds.length });
      commitBotCmds(store, serverId, entry.sender, cmds);
    } else {
      console.warn(
        "[bot-cmds] DECODE FAILED — sample base64:",
        joined.slice(0, 80),
        "...",
        joined.slice(-80),
      );
    }
  });
}

/** Send a +draft/bot-cmds-query TAGMSG to <botNick> (the tag is valueless). */
export function queryBotCommands(serverId: string, botNick: string): void {
  ircClient.sendRaw(serverId, `@+draft/bot-cmds-query TAGMSG ${botNick}`);
}

/**
 * Query bot-cmds for every isBot=true user in the channel that we
 * don't already have a cached schema for.  Called from the chat input
 * the first time the user starts typing a '/' so the popover has
 * something to show even if WHO_END fired before our handler attached
 * (e.g. cap negotiation happened between joining and registering).
 */
export function queryUncachedBotsInChannel(
  serverId: string,
  channelName: string,
): void {
  const state = useStore.getState();
  const server = state.servers.find((s) => s.id === serverId);
  if (!server) return;
  const channel = server.channels.find(
    (c) => c.name.toLowerCase() === channelName.toLowerCase(),
  );
  if (!channel) return;
  const cache = server.botCommands ?? {};
  for (const u of channel.users) {
    if (!u.isBot) continue;
    const key = u.username.toLowerCase();
    if (cache[key]) continue;
    queryBotCommands(serverId, u.username);
  }
}
