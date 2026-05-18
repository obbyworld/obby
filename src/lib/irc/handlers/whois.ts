import type { WhoisSession } from "../../../types";
import type { IRCClientContext } from "../IRCClientContext";

/** Reserved key under which we stash the synthesized "single-session"
 * record on a parent obby.world/whois batch.  A real per-session
 * sub-batch is keyed by its own batch ref, which is a server-assigned
 * BATCHLEN-long alphanumeric token — this sentinel can't collide. */
const IMPLICIT_SESSION_KEY = "__implicit__";

/**
 * Find the WhoisSession record that this WHOIS numeric should populate.
 *
 * - Inside an obby.world/whois-session sub-batch: route to that
 *   session's record (privileged multi-session view).
 * - Inside the parent obby.world/whois batch but NOT in a sub-batch:
 *   route to a lazily-created "implicit" Session 1.  This covers the
 *   single-session case (regular users, bots), the no-persistence
 *   case, and the non-privileged-querier case where the server emits
 *   a single consolidated set of per-session numerics for the
 *   canonical session inside the parent batch.
 * - Otherwise (no batch context): return null, meaning "fire the
 *   legacy account-level event so the old modal still works".
 */
function sessionFromMtags(
  ctx: IRCClientContext,
  serverId: string,
  mtags: Record<string, string> | undefined,
): WhoisSession | null {
  const ref = mtags?.batch;
  if (!ref) return null;
  const batch = ctx.activeBatches.get(serverId)?.get(ref);
  if (!batch) return null;

  if (batch.type === "obby.world/whois-session") {
    const parentRef = batch.batchTags?.batch;
    if (!parentRef) return null;
    const builder = ctx.whoisBuilders.get(serverId)?.get(parentRef);
    return builder?.sessionsByRef.get(ref) ?? null;
  }

  if (batch.type === "obby.world/whois") {
    const builder = ctx.whoisBuilders.get(serverId)?.get(ref);
    if (!builder) return null;
    let implicit = builder.sessionsByRef.get(IMPLICIT_SESSION_KEY);
    if (!implicit) {
      implicit = { ordinal: 1 };
      builder.sessionsByRef.set(IMPLICIT_SESSION_KEY, implicit);
    }
    return implicit;
  }

  return null;
}

/**
 * Inspect a parent-batch 320 numeric for the server's privacy-
 * preserving "is connected from N sessions" summary line and stash
 * the count on the parent builder so OBBY_WHOIS_COMPLETE can carry
 * it.  Returns true if we matched, so the caller can decide whether
 * to also fire the legacy WHOIS_SPECIAL event.  The line is in the
 * parent batch (not a sub-batch).
 */
function tryCaptureSessionCountSummary(
  ctx: IRCClientContext,
  serverId: string,
  mtags: Record<string, string> | undefined,
  message: string,
): boolean {
  const parentRef = mtags?.batch;
  if (!parentRef) return false;
  const parentBatch = ctx.activeBatches.get(serverId)?.get(parentRef);
  if (parentBatch?.type !== "obby.world/whois") return false;
  // "is connected from 3 sessions"
  const m = message.match(/is connected from\s+(\d+)\s+session(?:s)?/i);
  if (!m) return false;
  const builder = ctx.whoisBuilders.get(serverId)?.get(parentRef);
  if (builder) builder.summaryCount = Number.parseInt(m[1], 10);
  return true;
}

export function handleWhoisUser(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const username = parv[2];
  const host = parv[3];
  const realname = parv.slice(5).join(" ");
  ctx.triggerEvent("WHOIS_USER", {
    serverId,
    nick,
    username,
    host,
    realname,
  });
}

export function handleWhoisServer(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const server = parv[2];
  const serverInfo = parv.slice(3).join(" ");
  ctx.triggerEvent("WHOIS_SERVER", {
    serverId,
    nick,
    server,
    serverInfo,
  });
}

export function handleWhoisIdle(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const idle = Number.parseInt(parv[2], 10);
  const signon = Number.parseInt(parv[3], 10);
  const session = sessionFromMtags(ctx, serverId, mtags);
  if (session) {
    session.idle = idle;
    session.signon = signon;
    return;
  }
  ctx.triggerEvent("WHOIS_IDLE", {
    serverId,
    nick,
    idle,
    signon,
  });
}

export function handleWhoisEnd(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  ctx.triggerEvent("WHOIS_END", { serverId, nick });
}

export function handleWhoisChannels(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const channels = parv.slice(2).join(" ");
  ctx.triggerEvent("WHOIS_CHANNELS", { serverId, nick, channels });
}

export function handleWhoisSpecial(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const message = parv.slice(2).join(" ");

  // obby.world/whois-security-groups sub-batch: trailing is a bare
  // group name (no human prefix). Route into the parent builder's
  // securityGroups array and skip the WHOIS_SPECIAL event so the
  // group names don't pollute specialMessages.
  const ref = mtags?.batch;
  if (ref) {
    const sub = ctx.activeBatches.get(serverId)?.get(ref);
    if (sub?.type === "obby.world/whois-security-groups") {
      const parentRef = sub.batchTags?.batch;
      const builder = parentRef
        ? ctx.whoisBuilders.get(serverId)?.get(parentRef)
        : undefined;
      if (builder) {
        const group = message.trim();
        if (group) builder.securityGroups.push(group);
      }
      return;
    }
  }

  // Privacy summary "is connected from N sessions" -- emitted in the
  // parent obby.world/whois batch when the querier is not privileged
  // to see per-session sub-batches but the account has 2+ sessions.
  // Capture the count for OBBY_WHOIS_COMPLETE; still also fire
  // WHOIS_SPECIAL so the legacy specialMessages list contains the
  // line for back-compat with the old modal.
  tryCaptureSessionCountSummary(ctx, serverId, mtags, message);
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

/** RPL_WHOISHOST (378): "is connecting from <ident>@<host> <ip>" */
export function handleWhoisHost(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const message = parv.slice(2).join(" ");
  const session = sessionFromMtags(ctx, serverId, mtags);
  if (session) {
    // "is connecting from <ident>@<realhost> <ip>"
    const m = message.match(/is connecting from\s+(\S+)@(\S+)(?:\s+(\S+))?/i);
    if (m) {
      session.ident = m[1] === "*" ? undefined : m[1];
      session.realhost = m[2];
      if (m[3]) session.ip = m[3];
    }
    return;
  }
  // Legacy / unbatched: fall through to WHOIS_SPECIAL so the old
  // modal's specialMessages list still gets it.
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

/** RPL_WHOISMODES (379).
 *
 * Two wire shapes in the wild:
 *
 *   - Standard (parent batch, what obbyircd emits today): trailing
 *       `:is using modes <umodes> <snomask>`
 *     so parv[2] is the whole human-readable string.
 *   - Legacy per-session-sub-batch (older obbyircd builds): positional
 *       `... 379 querier target <umodes> <snomask>`
 *     so parv[2]=umodes, parv[3]=snomask.
 *
 * Handle both: try to extract "+umodes [snomask]" from parv[2] first,
 * fall back to positional. Modes are account-level (synced across
 * sessions by the server's persistence module) so route to the
 * structured WHOIS_MODES event regardless of which container they
 * arrived in. */
export function handleWhoisModes(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];

  let umodes: string | undefined;
  let snomask: string | undefined;
  // Try trailing form: ":is using modes <umodes> [<snomask>]"
  const trailingMatch = parv[2]?.match(/is using modes\s+(\S+)(?:\s+(\S+))?/i);
  if (trailingMatch) {
    umodes = trailingMatch[1];
    snomask = trailingMatch[2];
  } else if (parv[2]?.startsWith("+") || parv[2]?.startsWith("-")) {
    // Positional: parv[2]=umodes parv[3]=snomask
    umodes = parv[2];
    snomask = parv[3] || undefined;
  }

  if (umodes) {
    ctx.triggerEvent("WHOIS_MODES", {
      serverId,
      nick,
      umodes,
      snomask: snomask || undefined,
    });
  }
  // Also fire WHOIS_SPECIAL so the legacy UserProfileModal's
  // specialMessages list keeps showing this line on non-obby servers.
  const message = parv.slice(2).join(" ");
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

/** RPL_WHOISCERTFP (276): "has client certificate fingerprint <fp>" */
export function handleWhoisCertfp(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const message = parv.slice(2).join(" ");
  const session = sessionFromMtags(ctx, serverId, mtags);
  if (session) {
    const m = message.match(/has client certificate fingerprint\s+(\S+)/i);
    if (m) session.certFp = m[1];
    return;
  }
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

/** RPL_WHOISCOUNTRY (344): "<cc> :is connecting from <country-name>" */
export function handleWhoisCountry(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const session = sessionFromMtags(ctx, serverId, mtags);
  // parv[2] is country code, trailing is "is connecting from <country name>"
  const countryCode = parv[2];
  const trailing = parv.slice(3).join(" ");
  const nameMatch = trailing.match(/is connecting from\s+(.+)/i);
  const countryName = nameMatch?.[1];
  if (session) {
    if (countryCode) session.countryCode = countryCode;
    if (countryName) session.countryName = countryName;
    return;
  }
  const message = parv.slice(2).join(" ");
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

/**
 * RPL_WHOISASN (569): "<asn> :is connecting from AS<asn> [<asname>]"
 * The obbyircd format we ship pads parv[2] with the numeric ASN and
 * encodes the AS name in brackets at the tail.
 */
export function handleWhoisAsn(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const session = sessionFromMtags(ctx, serverId, mtags);
  const asnRaw = Number.parseInt(parv[2] ?? "", 10);
  const asn = Number.isFinite(asnRaw) && asnRaw > 0 ? asnRaw : undefined;
  const trailing = parv.slice(3).join(" ");
  const nameMatch = trailing.match(/\[([^\]]+)\]/);
  const asname = nameMatch?.[1];
  if (session) {
    if (asn !== undefined) session.asn = asn;
    if (asname) session.asname = asname;
    return;
  }
  const message = parv.slice(2).join(" ");
  ctx.triggerEvent("WHOIS_SPECIAL", { serverId, nick, message });
}

export function handleWhoisAccount(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const account = parv[2];
  ctx.triggerEvent("WHOIS_ACCOUNT", { serverId, nick, account });
}

export function handleWhoisSecure(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const nick = parv[1];
  const message = parv.slice(2).join(" ");
  const session = sessionFromMtags(ctx, serverId, mtags);
  if (session) {
    session.secureConnection = message;
    return;
  }
  ctx.triggerEvent("WHOIS_SECURE", { serverId, nick, message });
}

export function handleWhoisBot(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const nick = parv[0];
  const target = parv[1];
  const message = parv.slice(2).join(" ");
  ctx.triggerEvent("WHOIS_BOT", { serverId, nick, target, message });
}

export function handleWhoReply(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  const username = parv[2];
  const host = parv[3];
  const server = parv[4];
  const nick = parv[5];
  const flags = parv[6];

  const trailing = parv[7] || "";
  const spaceIndex = trailing.indexOf(" ");
  let hopcount = trailing;
  let realname = "";

  if (spaceIndex !== -1) {
    hopcount = trailing.substring(0, spaceIndex);
    realname = trailing.substring(spaceIndex + 1);
  }

  ctx.triggerEvent("WHO_REPLY", {
    serverId,
    channel,
    username,
    host,
    server,
    nick,
    flags,
    hopcount,
    realname,
  });
}

export function handleWhoxReply(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  const username = parv[2];
  const host = parv[3];
  const nick = parv[4];
  const flags = parv[5];
  const account = parv[6];
  const _opLevelField = parv[7] || "";
  const realname = parv[8] || "";

  const isAway = flags.includes("G");

  let opLevel = "";
  if (flags.length > 1) {
    const statusPart = flags.substring(1);
    opLevel = statusPart
      .split("")
      .filter((char) => ["@", "+", "~", "%", "&"].includes(char))
      .join("");
  }

  ctx.triggerEvent("WHOX_REPLY", {
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
  });
}

export function handleWhoEnd(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const mask = parv[1];
  ctx.triggerEvent("WHO_END", { serverId, mask });
}
