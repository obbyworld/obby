/**
 * Slash command names we refuse to route to a bot unless the bot is
 * independently trusted by the local network — a config-defined entry
 * in the obby.world/channel-bots pushbot registry (`from_config: true`)
 * or a server/services source.  Otherwise a third-party channel bot
 * registering `oper` or `identify` becomes a credential-capture vector.
 *
 * Used in two places:
 *   - useMessageSending.ts refuses to dispatch ANY of these names to
 *     ANY bot, full stop (defence in depth — a normal user typing
 *     `/oper x y` should NEVER reach a +draft/bot-cmd TAGMSG).
 *   - pushbot.ts strips matching entries from a bot's command schema
 *     at ingest unless the bot is `from_config: true`, so the slash
 *     picker and the bots modal don't even show the entries for a
 *     regular channel bot.
 */
export const PRIVILEGED_COMMANDS: ReadonlySet<string> = new Set([
  "oper",
  "deoper",
  "ns",
  "nickserv",
  "cs",
  "chanserv",
  "ms",
  "memoserv",
  "os",
  "operserv",
  "bs",
  "botserv",
  "hs",
  "hostserv",
  "identify",
  "register",
  "ghost",
  "recover",
  "regain",
  "release",
  "sajoin",
  "sapart",
  "sanick",
  "samode",
  "saquit",
  "kill",
  "kline",
  "gline",
  "zline",
  "shun",
  "kick",
  "mode",
  "ban",
  "unban",
  "akick",
  "akill",
  "restart",
  "rehash",
  "die",
  "msg",
  "query",
  "sendpass",
  "setpass",
  "resetpass",
  "login",
  "logout",
  "auth",
  "pass",
  "password",
  "server",
  "connect",
  "squit",
  "certfp",
  "tls",
  "sasl",
]);

/** True when this bot is independently trusted to register privileged
 *  command names: a config-defined entry in the server's pushbot
 *  registry.  Other bots — including +B nicks self-registered via
 *  draft/bot-cmds — are NOT trusted to register `oper`, `identify`,
 *  etc., and any such entries in their command list are stripped at
 *  ingest. */
export function botCanRegisterPrivileged(
  bot: { from_config?: boolean } | null | undefined,
): boolean {
  return bot?.from_config === true;
}
