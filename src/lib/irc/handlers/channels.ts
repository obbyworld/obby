import { parseNamesResponse } from "../../ircUtils";
import type { IRCClientContext } from "../IRCClientContext";
import { getNickFromNuh } from "../utils";

export function handleMode(
  ctx: IRCClientContext,
  serverId: string,
  source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const sender = getNickFromNuh(source);
  const target = parv[0];
  const modestring = parv[1] || "";
  const modeargs = parv.slice(2);
  ctx.triggerEvent("MODE", {
    serverId,
    mtags,
    sender,
    target,
    modestring,
    modeargs,
  });
}

export function handleTopic(
  ctx: IRCClientContext,
  serverId: string,
  source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[0];
  const topic = parv.slice(1).join(" ");
  const sender = getNickFromNuh(source);
  ctx.triggerEvent("TOPIC", {
    serverId,
    channelName,
    topic,
    sender,
  });
}

export function handleRplTopic(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[1];
  const topic = parv.slice(2).join(" ");
  ctx.triggerEvent("RPL_TOPIC", {
    serverId,
    channelName,
    topic,
  });
}

export function handleRplTopicWhoTime(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[1];
  const setter = parv[2];
  const timestamp = Number.parseInt(parv[3], 10);
  ctx.triggerEvent("RPL_TOPICWHOTIME", {
    serverId,
    channelName,
    setter,
    timestamp,
  });
}

export function handleRplNoTopic(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[1];
  ctx.triggerEvent("RPL_NOTOPIC", {
    serverId,
    channelName,
  });
}

export function handleRename(
  ctx: IRCClientContext,
  serverId: string,
  source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const user = getNickFromNuh(source);
  const oldName = parv[0];
  const newName = parv[1];
  const reason = parv.slice(2).join(" "); // trailing already parsed into parv
  ctx.triggerEvent("RENAME", {
    serverId,
    oldName,
    newName,
    reason,
    user,
  });
}

export function handleNames(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[2];
  const namesStr = parv.slice(3).join(" ").trim();
  const names = namesStr.startsWith(":") ? namesStr.substring(1) : namesStr;
  const newUsers = parseNamesResponse(names);
  ctx.triggerEvent("NAMES", {
    serverId,
    channelName,
    users: newUsers,
  });
}

export function handleListChannel(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[1];
  const userCount = parv[2] ? Number.parseInt(parv[2], 10) : 0;
  const topic = parv.slice(3).join(" ");
  ctx.triggerEvent("LIST_CHANNEL", {
    serverId,
    channel: channelName,
    userCount,
    topic,
  });
}

export function handleListEnd(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  _parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  ctx.triggerEvent("LIST_END", { serverId });
}

export function handleJoinRefused(
  ctx: IRCClientContext,
  serverId: string,
  parv: string[],
  isThrottled: boolean,
): void {
  ctx.triggerEvent("JOIN_REFUSED", {
    serverId,
    channelName: parv[1],
    isThrottled,
  });
}

export function handleRplChannelModeIs(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channelName = parv[1];
  const modestring = parv[2] || "";
  const modeargs = parv.slice(3);
  ctx.triggerEvent("RPL_CHANNELMODEIS", {
    serverId,
    channelName,
    modestring,
    modeargs,
  });
}

export function handleRplBanList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  const mask = parv[2];
  const setter = parv[3];
  const timestamp = Number.parseInt(parv[4], 10);
  ctx.triggerEvent("RPL_BANLIST", {
    serverId,
    channel,
    mask,
    setter,
    timestamp,
  });
}

export function handleRplInviteList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  const mask = parv[2];
  const setter = parv[3];
  const timestamp = Number.parseInt(parv[4], 10);
  ctx.triggerEvent("RPL_INVITELIST", {
    serverId,
    channel,
    mask,
    setter,
    timestamp,
  });
}

export function handleRplExceptList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  const mask = parv[2];
  const setter = parv[3];
  const timestamp = Number.parseInt(parv[4], 10);
  ctx.triggerEvent("RPL_EXCEPTLIST", {
    serverId,
    channel,
    mask,
    setter,
    timestamp,
  });
}

export function handleRplEndOfBanList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  ctx.triggerEvent("RPL_ENDOFBANLIST", { serverId, channel });
}

export function handleRplEndOfInviteList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  ctx.triggerEvent("RPL_ENDOFINVITELIST", { serverId, channel });
}

export function handleRplEndOfExceptList(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const channel = parv[1];
  ctx.triggerEvent("RPL_ENDOFEXCEPTLIST", { serverId, channel });
}
