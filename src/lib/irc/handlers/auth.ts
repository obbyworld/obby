import type { IRCClientContext } from "../IRCClientContext";

export function handleAuthenticate(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const param = parv.join(" ");
  ctx.triggerEvent("AUTHENTICATE", { serverId, param });
}

// IRCv3 standard-replies wire form:
//   <prefix> {FAIL,WARN,NOTE,SUCCESS} <command> <code> [<context>...] :<description>
// `description` is the human-readable text, always the trailing param.
// `context` is zero or more identifiers (channel, nick, account) the
// description refers to. `command` and `code` are computer-readable tokens.
export function splitStandardReply(
  parv: string[],
  trailing: string,
): { command: string; code: string; context: string[]; message: string } {
  const command = parv[0];
  const code = parv[1];
  // The parser pushes the trailing param onto parv as its last element when
  // present. Pop it back off so context = the strings strictly between code
  // and the description.
  const hasTrailing = trailing.length > 0;
  const ctxEnd = hasTrailing ? parv.length - 1 : parv.length;
  const context = parv.slice(2, ctxEnd);
  const message = hasTrailing ? trailing : parv.slice(2).join(" ");
  return { command, code, context, message };
}

export function handleFail(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const { command, code, context, message } = splitStandardReply(
    parv,
    trailing,
  );
  ctx.triggerEvent("FAIL", {
    serverId,
    mtags,
    command,
    code,
    target: context[0],
    context,
    message,
  });
  // draft/account-recovery typed projections so components don't
  // have to filter the FAIL stream by command on every render.
  if (command === "RECOVER")
    ctx.triggerEvent("RECOVER_FAIL", { serverId, mtags, code, message });
  else if (command === "SETPASS")
    ctx.triggerEvent("SETPASS_FAIL", { serverId, mtags, code, message });
  // draft/persistence FAIL projection
  else if (command === "PERSISTENCE")
    ctx.triggerEvent("PERSISTENCE_FAIL", { serverId, mtags, code, message });
  // draft/read-marker FAIL projection.  The MARKREAD FAIL form has
  // an optional <target> in parv[2]; the message is whatever's left.
  else if (command === "MARKREAD") {
    ctx.triggerEvent("MARKREAD_FAIL", {
      serverId,
      mtags,
      code,
      target: context[0],
      message,
    });
  }
}

export function handleWarn(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const { command, code, context, message } = splitStandardReply(
    parv,
    trailing,
  );
  ctx.triggerEvent("WARN", {
    serverId,
    mtags,
    command,
    code,
    target: context[0],
    context,
    message,
  });
}

export function handleNote(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const { command, code, context, message } = splitStandardReply(
    parv,
    trailing,
  );
  ctx.triggerEvent("NOTE", {
    serverId,
    mtags,
    command,
    code,
    target: context[0],
    context,
    message,
  });
  if (command === "2FA") {
    ctx.triggerEvent("TWOFA_NOTE", {
      serverId,
      mtags,
      code,
      args: parv.slice(2),
    });
  }
  // draft/account-recovery typed projections
  if (command === "RECOVER") {
    ctx.triggerEvent("RECOVER_NOTE", {
      serverId,
      mtags,
      code,
      args: parv.slice(2),
    });
  } else if (command === "SETPASS") {
    ctx.triggerEvent("SETPASS_NOTE", {
      serverId,
      mtags,
      code,
      args: parv.slice(2),
    });
  }
}

export function handleSuccess(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const { command, code, context, message } = splitStandardReply(
    parv,
    trailing,
  );
  ctx.triggerEvent("SUCCESS", {
    serverId,
    mtags,
    command,
    code,
    target: context[0],
    context,
    message,
  });
}

export function handleRegister(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing = "",
): void {
  const subcommand = parv[0];
  // REGISTER replies: REGISTER {SUCCESS,VERIFICATION_REQUIRED} <account> :<description>
  // The description is the trailing param.
  const account = parv[1];
  const message = trailing || parv.slice(2).join(" ");
  if (subcommand === "SUCCESS") {
    ctx.triggerEvent("REGISTER_SUCCESS", { serverId, mtags, account, message });
  } else if (subcommand === "VERIFICATION_REQUIRED") {
    ctx.triggerEvent("REGISTER_VERIFICATION_REQUIRED", {
      serverId,
      mtags,
      account,
      message,
    });
  }
}

// VERIFY SUCCESS currently produces no event (no-op in original code)
export function handleVerify(
  _ctx: IRCClientContext,
  _serverId: string,
  _source: string,
  _parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  // original code only handles VERIFY SUCCESS with local variables, fires no event
}

// draft/authtoken: TOKEN GENERATE / TOKEN SERVICE.  TOKEN VALIDATE/CLAIM
// is server-internal (only sent by other servers, never to clients) so
// we don't dispatch on it.
export function handleToken(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const sub = parv[0]?.toUpperCase();
  if (sub === "GENERATE") {
    // TOKEN GENERATE <service> <url> :<token>
    const service = parv[1] ?? "";
    const url = parv[2] ?? "";
    const token = (parv[3] ?? "").replace(/^:/, "");
    ctx.triggerEvent("TOKEN_GENERATE", { serverId, service, url, token });
    return;
  }
  if (sub === "SERVICE") {
    // TOKEN SERVICE <name> <url> :<description> -- batched inside
    // draft/authtoken; we just emit one event per line.
    const service = parv[1] ?? "";
    const url = parv[2] ?? "";
    const description = (parv[3] ?? "").replace(/^:/, "");
    ctx.triggerEvent("TOKEN_SERVICE", { serverId, service, url, description });
    return;
  }
  // CLAIM and VALIDATE never reach a client; ignore quietly.
}

// `:server 2FA <subcommand> [SUCCESS] [arg ...] :description`
// Examples:
//   :server 2FA ADD SUCCESS totp cred-1 :Credential 'Phone' registered.
//   :server 2FA REMOVE SUCCESS cred-1 :...
//   :server 2FA ENABLE SUCCESS :...
//   :server 2FA DISABLE SUCCESS :...
export function handleTwoFA(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
): void {
  const subcommand = parv[0];
  const status = parv[1];
  const args = parv.slice(2);
  ctx.triggerEvent("TWOFA", {
    serverId,
    mtags,
    subcommand,
    status,
    args,
  });
}

export function handleExtjwt(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const requestedTarget = parv[0];
  const serviceName = parv[1];
  let jwtToken: string;
  if (parv[2] === "*") {
    jwtToken = parv[3];
  } else {
    jwtToken = parv[2];
  }
  ctx.triggerEvent("EXTJWT", {
    serverId,
    requestedTarget,
    serviceName,
    jwtToken,
  });
}

// draft/persistence: server reply to PERSISTENCE GET / SET
//   :server PERSISTENCE STATUS <client-setting> <effective-setting>
// where client-setting is ON | OFF | DEFAULT and effective is ON | OFF.
export function handlePersistence(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
): void {
  const sub = parv[0]?.toUpperCase();
  if (sub !== "STATUS") return;
  const rawPref = (parv[1] ?? "").toUpperCase();
  const rawEff = (parv[2] ?? "").toUpperCase();
  const preference: "ON" | "OFF" | "DEFAULT" =
    rawPref === "ON" || rawPref === "OFF" ? rawPref : "DEFAULT";
  const effective: "ON" | "OFF" = rawEff === "ON" ? "ON" : "OFF";
  ctx.triggerEvent("PERSISTENCE_STATUS", { serverId, preference, effective });
}
