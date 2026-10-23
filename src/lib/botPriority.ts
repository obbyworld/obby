import type { PushBotInfo } from "../types";

export const SYNTHESISED_BOT_ID_PREFIX = "draft-bot-cmds:";

// When several bots offer a bare `/cmd`, a network bot answers first, then a
// channel bot from the bot directory, then any other bot.
export function botPriority(bot: PushBotInfo | undefined): number {
  if (bot?.scope === "server") return 0;
  if (bot && !bot.bot_id.startsWith(SYNTHESISED_BOT_ID_PREFIX)) return 1;
  return 2;
}
