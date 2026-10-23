/**
 * obbyircd INVITELINK reply parser.
 *
 * Two distinct shapes share the IRC command "INVITELINK":
 *
 *   1. `:server INVITELINK <share-id> <channel|*> :<url>`
 *      Single-row response to a successful `INVITELINK CREATE`.
 *
 *   2. `:server INVITELINK ENTRY <id> <chan|*> <iso8601> <count> <url> [:<descr>]`
 *      One per row in the response to `INVITELINK LIST`. Terminated
 *      by `NOTE INVITELINK LIST_END` (handled via the generic NOTE
 *      pipeline by filtering on command="INVITELINK").
 *
 * NOTE INVITELINK DELETED / FAIL INVITELINK error paths also ride
 * the generic NOTE / FAIL events; consumers filter on the `command`
 * field.
 */
import type { IRCClientContext } from "../IRCClientContext";

export function handleInvitelink(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  if (parv.length < 2) return;

  // parv[0] = our own nick (server addressed us as :server CMD <us> ...)
  // Actually for vendor server-originated commands, parv shape:
  //   [<share-id>, <channel|*>, <url>]                       (CREATE form)
  //   ["ENTRY", <id>, <chan|*>, <iso>, <count>, <url>, ...]  (LIST form)

  if (parv[0] === "ENTRY") {
    const shareId = parv[1];
    const channelRaw = parv[2];
    const iso = parv[3];
    const countRaw = parv[4];
    const url = parv[5];
    const description = parv.length >= 7 ? parv[6] : undefined;
    if (!shareId || !url) return;
    const count = Number.parseInt(countRaw ?? "0", 10);
    ctx.triggerEvent("INVITELINK_ENTRY", {
      serverId,
      shareId,
      channel: channelRaw && channelRaw !== "*" ? channelRaw : undefined,
      createdAt: iso ?? "",
      redeemCount: Number.isFinite(count) ? count : 0,
      url,
      description:
        description && description.length > 0 ? description : undefined,
    });
    return;
  }

  // CREATE form. parv[0]=share-id, parv[1]=channel|*, parv[2]=url
  const shareId = parv[0];
  const channelRaw = parv[1];
  const url = parv[2];
  if (!shareId || !url) return;
  ctx.triggerEvent("INVITELINK_CREATED", {
    serverId,
    shareId,
    channel: channelRaw && channelRaw !== "*" ? channelRaw : undefined,
    url,
  });
}
