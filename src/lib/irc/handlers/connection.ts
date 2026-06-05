import { parseIsupport } from "../../ircUtils";
import type { IRCClientContext } from "../IRCClientContext";

export function handlePing(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  const key = parv.join(" ");
  ctx.sendRaw(serverId, `PONG :${key}`);
}

export function handlePong(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  _parv: string[],
): void {
  const pongTimeout = ctx.pongTimeouts.get(serverId);
  if (pongTimeout) {
    clearTimeout(pongTimeout);
    ctx.pongTimeouts.delete(serverId);
  }
}

export function handleError(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  const errorMessage = parv.join(" ");
  console.log(`IRC ERROR from server ${serverId}: ${errorMessage}`);

  if (ctx.isRateLimitError(errorMessage)) {
    console.log(
      `Server ${serverId} rate-limited. Stopping reconnection attempts.`,
    );
    ctx.rateLimitedServers.set(serverId, Date.now());

    const timeout = ctx.reconnectionTimeouts.get(serverId);
    if (timeout) {
      clearTimeout(timeout);
      ctx.reconnectionTimeouts.delete(serverId);
    }

    const server = ctx.servers.get(serverId);
    if (server) {
      server.connectionState = "disconnected";
      ctx.triggerEvent("connectionStateChange", {
        serverId: server.id,
        connectionState: "disconnected",
      });
    }

    ctx.triggerEvent("rateLimited", {
      serverId,
      message: errorMessage,
      retryAfter: 600000,
    });
  }
}

export function handleRplWelcome(
  ctx: IRCClientContext,
  serverId: string,
  source: string,
  parv: string[],
): void {
  const serverName = source;
  const nickname = parv[0];

  ctx.nicks.set(serverId, nickname);

  const currentUser = ctx.currentUsers.get(serverId);
  if (currentUser) {
    ctx.currentUsers.set(serverId, {
      ...currentUser,
      username: nickname,
    });
  }

  ctx.triggerEvent("ready", { serverId, serverName, nickname });

  ctx.startWebSocketPing(serverId);

  const server = ctx.servers.get(serverId);
  if (server && server.channels.length > 0) {
    console.log(
      `Rejoining ${server.channels.length} channels after reconnection`,
    );
    for (const channel of server.channels) {
      ctx.sendRaw(serverId, `JOIN ${channel.name}`);
    }
  }
}

export function handleRplYourHost(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  const message = parv.slice(1).join(" ");
  const match = message.match(/Your host is ([^,]+), running version (.+)/);
  if (match) {
    const serverName = match[1];
    const version = match[2];
    ctx.triggerEvent("RPL_YOURHOST", {
      serverId,
      serverName,
      version,
    });
  }
}

export function handleIsupport(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  const capabilities = parseIsupport(parv.join(" "));
  for (const [key, value] of Object.entries(capabilities)) {
    if (key === "NETWORK") {
      const server = ctx.servers.get(serverId);
      if (server) {
        server.networkName = value;
        ctx.servers.set(serverId, server);
      }
    }
    ctx.triggerEvent("ISUPPORT", { serverId, key, value });
  }
}

export function handleCap(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
  _mtags: Record<string, string> | undefined,
  trailing: string,
): void {
  let i = 0;
  let caps = "";
  if (parv[i] === "*") {
    i++;
  }
  let subcommand = parv[i++];
  if (
    subcommand !== "LS" &&
    subcommand !== "ACK" &&
    subcommand !== "NEW" &&
    subcommand !== "DEL" &&
    subcommand !== "NAK"
  ) {
    subcommand = parv[i++];
  }
  const isFinal = subcommand === "LS" && parv[i] !== "*";
  if (parv[i] === "*") i++;

  if (trailing) {
    caps = trailing;
  } else {
    while (parv[i]) {
      caps += parv[i++];
      if (parv[i]) caps += " ";
    }
  }

  if (subcommand === "LS") ctx.onCapLs(serverId, caps, isFinal);
  else if (subcommand === "ACK") {
    ctx.onCapAck(serverId, caps);
  } else if (subcommand === "NAK") {
    ctx.sendCapEnd(serverId);
    ctx.capNegotiationComplete.set(serverId, true);
  } else if (subcommand === "NEW") ctx.onCapNew(serverId, caps);
  else if (subcommand === "DEL") ctx.onCapDel(serverId, caps);
}

export function handleRplYoureOper(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  parv: string[],
): void {
  const message = parv.slice(1).join(" ");
  ctx.triggerEvent("RPL_YOUREOPER", {
    serverId,
    message,
  });
}

export function handleSaslSuccess(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  _parv: string[],
): void {
  ctx.sendCapEnd(serverId);
  ctx.capNegotiationComplete.set(serverId, true);
  ctx.userOnConnect(serverId);
}

export function handleSaslFailure(
  ctx: IRCClientContext,
  serverId: string,
  _source: string,
  _parv: string[],
): void {
  ctx.sendCapEnd(serverId);
  ctx.capNegotiationComplete.set(serverId, true);
  ctx.userOnConnect(serverId);
}
