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
  store.setState((state) => ({
    servers: state.servers.map((s) => {
      if (s.id !== serverId) return s;
      const existingBot = s.bots?.[key];
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
        commands: cmds,
      };
      return {
        ...s,
        botCommands: { ...(s.botCommands ?? {}), [key]: cmds },
        bots: {
          ...(s.bots ?? {}),
          [key]: existingBot
            ? { ...existingBot, commands: cmds }
            : { ...synthesisedBot, channels: sharedChannels, commands: cmds },
        },
      };
    }),
  }));
}

export function registerPushBotHandlers(store: StoreApi<AppState>): void {
  // When WHO completes for a channel, pre-fetch slash-command schemas
  // for any +B users we now share a channel with so the autocomplete
  // cache is warm by the time the user types '/'.
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
      if (batchRef && botCmdsBatches.has(`${serverId}:${batchRef}`)) {
        botCmdsBatches
          .get(`${serverId}:${batchRef}`)
          ?.fragments.push(mtags["+draft/bot-cmds"]);
        return;
      }
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
          if (current.includes(key)) return s;
          return { ...s, botCommandsLoading: [...current, key] };
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
