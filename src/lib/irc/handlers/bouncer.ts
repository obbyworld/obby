// Dispatches the soju.im/bouncer-networks BOUNCER command and the
// FAIL BOUNCER standard-replies error variant. See the spec:
//   https://codeberg.org/emersion/soju/src/branch/master/doc/ext/bouncer-networks.md
//
// We keep the dispatcher dumb and turn every flavour into a typed event
// that the store can consume. Attribute decoding lives in bouncerAttrs.

import { decodeBouncerAttrs } from "../../bouncerAttrs";
import type { IRCClientContext } from "../IRCClientContext";

export function handleBouncer(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  // parv[0] is the subcommand (server uses uppercase but spec calls it
  // case-insensitive so be permissive).
  const subcommand = parv[0]?.toUpperCase();
  switch (subcommand) {
    case "NETWORK": {
      // BOUNCER NETWORK <netid> <attrs|"*">
      const netid = parv[1];
      const payload = parv[2] ?? "";
      if (!netid) return;
      if (payload === "*") {
        ctx.triggerEvent("BOUNCER_NETWORK", {
          serverId,
          netid,
          deleted: true,
          attributes: {},
          batchTag: mtags?.batch,
        });
        return;
      }
      ctx.triggerEvent("BOUNCER_NETWORK", {
        serverId,
        netid,
        deleted: false,
        attributes: decodeBouncerAttrs(payload),
        batchTag: mtags?.batch,
      });
      return;
    }
    case "ADDNETWORK": {
      const netid = parv[1];
      if (netid) ctx.triggerEvent("BOUNCER_ADDNETWORK_OK", { serverId, netid });
      return;
    }
    case "CHANGENETWORK": {
      const netid = parv[1];
      if (netid)
        ctx.triggerEvent("BOUNCER_CHANGENETWORK_OK", { serverId, netid });
      return;
    }
    case "DELNETWORK": {
      const netid = parv[1];
      if (netid) ctx.triggerEvent("BOUNCER_DELNETWORK_OK", { serverId, netid });
      return;
    }
  }
}

// FAIL BOUNCER <code> <subcommand> [context...] :<description>
//
// Spec contexts vary by code:
//   INVALID_NETID         FAIL BOUNCER INVALID_NETID <sub> <netid> :...
//   INVALID_ATTRIBUTE     FAIL BOUNCER INVALID_ATTRIBUTE <sub> <netid|*> <attr> :...
//   READ_ONLY_ATTRIBUTE   same shape
//   UNKNOWN_ATTRIBUTE     same shape
//   NEED_ATTRIBUTE        FAIL BOUNCER NEED_ATTRIBUTE ADDNETWORK <attr> :...
//   ACCOUNT_REQUIRED      FAIL BOUNCER ACCOUNT_REQUIRED BIND :...
//   REGISTRATION_IS_COMPLETED  FAIL BOUNCER REGISTRATION_IS_COMPLETED BIND :...
//   UNKNOWN_COMMAND       FAIL BOUNCER UNKNOWN_COMMAND <sub> :...
//
// We hand all of this to the store as one event; the store / UI decides
// how to surface it (toast vs inline-on-modal).
export function handleBouncerFail(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  // parv = [ "BOUNCER", code, subcommand, ...context, description ]
  const [, code, subcommand, ...rest] = parv;
  if (!code) return;
  const description = rest.length > 0 ? rest[rest.length - 1] : "";
  const context = rest.slice(0, -1);
  // Helpful destructured fields for the common cases.
  let netid: string | undefined;
  let attribute: string | undefined;
  if (code === "INVALID_NETID") {
    netid = context[0];
  } else if (
    code === "INVALID_ATTRIBUTE" ||
    code === "READ_ONLY_ATTRIBUTE" ||
    code === "UNKNOWN_ATTRIBUTE"
  ) {
    netid = context[0];
    attribute = context[1];
  } else if (code === "NEED_ATTRIBUTE") {
    attribute = context[0];
  }
  ctx.triggerEvent("BOUNCER_FAIL", {
    serverId,
    code,
    subcommand: subcommand ?? "",
    netid,
    attribute,
    context,
    description,
  });
}
