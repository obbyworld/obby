import type { IRCClientContext } from "../IRCClientContext";

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
): void {
  const subcommand = parv[1];
  const code = parv[2];

  let paramCount = parv.length;
  let _errorMessage = "";

  if (paramCount > 3) {
    const lastParam = parv[paramCount - 1];
    if (lastParam && Number.isNaN(Number.parseInt(lastParam, 10))) {
      _errorMessage = lastParam;
      paramCount = paramCount - 1;
    }
  }

  let target: string | undefined;
  let key: string | undefined;
  let retryAfter: number | undefined;

  if (paramCount > 3) target = parv[3];
  if (paramCount > 4) key = parv[4];
  if (paramCount > 5 && code === "RATE_LIMITED") {
    retryAfter = Number.parseInt(parv[5], 10);
  }

  ctx.triggerEvent("METADATA_FAIL", {
    serverId,
    subcommand,
    code,
    target,
    key,
    retryAfter,
  });
}
