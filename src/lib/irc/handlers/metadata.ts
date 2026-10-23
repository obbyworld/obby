import type { IRCClientContext } from "../IRCClientContext";
import { splitStandardReply } from "./auth";

export function handleMetadata(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const target = parv[0];
  const key = parv[1];
  const visibility = parv[2] || "";
  // draft/metadata-2: SET = 4 params [target, key, "*", value]; DEL = 3 params [target, key, "*"] (no value)
  // Strip leading ":" — some clients double-encode the trailing param, leaving one colon after the parser strips its own.
  const rawValue = parv.length >= 4 ? parv[parv.length - 1] : "";
  const value = rawValue.startsWith(":") ? rawValue.substring(1) : rawValue;

  ctx.triggerEvent("METADATA", {
    serverId,
    target,
    key,
    visibility,
    value,
  });
}

export function handleMetadataWhoisKeyValue(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const target = parv[0];
  const key = parv[1];
  const visibility = parv[2];
  const rawWhoisValue = parv.slice(3).join(" ");
  const value = rawWhoisValue.startsWith(":")
    ? rawWhoisValue.substring(1)
    : rawWhoisValue;
  ctx.triggerEvent("METADATA_WHOIS", {
    serverId,
    target,
    key,
    visibility,
    value,
  });
}

export function handleMetadataKeyValue(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const _recipient = parv[0];
  const target = parv[1];
  let key = parv[2];
  let visibility = parv[3];
  let valueStartIndex = 4;

  if (parv[1] === parv[2] && parv.length > 5) {
    key = parv[3];
    visibility = parv[4];
    valueStartIndex = 5;
  }

  const value = parv.slice(valueStartIndex).join(" ");
  const cleanValue = value.startsWith(":") ? value.substring(1) : value;

  ctx.triggerEvent("METADATA_KEYVALUE", {
    serverId,
    target,
    key,
    visibility,
    value: cleanValue,
  });
}

export function handleMetadataKeyNotSet(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  // parv[0] = recipient (own nick), parv[1] = target, parv[2] = key
  // Same layout as 761 RPL_KEYVALUE
  const _recipient = parv[0];
  const target = parv[1];
  const key = parv[2];
  ctx.triggerEvent("METADATA_KEYNOTSET", { serverId, target, key });
}

export function handleMetadataSubOk(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const _target = parv[0];
  const keys = parv
    .slice(1)
    .map((key) => (key.startsWith(":") ? key.substring(1) : key));
  ctx.triggerEvent("METADATA_SUBOK", { serverId, keys });
}

export function handleMetadataUnsubOk(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const _target = parv[0];
  const keys = parv
    .slice(1)
    .map((key) => (key.startsWith(":") ? key.substring(1) : key));
  ctx.triggerEvent("METADATA_UNSUBOK", { serverId, keys });
}

export function handleMetadataSubs(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const _target = parv[0];
  const keys = parv
    .slice(1)
    .map((key) => (key.startsWith(":") ? key.substring(1) : key));
  ctx.triggerEvent("METADATA_SUBS", { serverId, keys });
}

export function handleMetadataSyncLater(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const target = parv[0];
  const retryAfter = parv[1] ? Number.parseInt(parv[1], 10) : undefined;
  ctx.triggerEvent("METADATA_SYNCLATER", { serverId, target, retryAfter });
}

export function handleMetadataFail(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const { code, context } = splitStandardReply(parv, trailing);
  const keyOnly = code === "KEY_INVALID" || code === "TOO_MANY_SUBS";
  const target = keyOnly ? undefined : context[0];
  const key = keyOnly ? context[0] : context[1];
  const retryAfter =
    code === "RATE_LIMITED" && context[2]
      ? Number.parseInt(context[2], 10)
      : undefined;

  ctx.triggerEvent("METADATA_FAIL", {
    serverId,
    code,
    target,
    key,
    retryAfter,
  });
}
