import { t } from "@lingui/core/macro";
import type { Server } from "../../types";
import type { SearchScope } from "./searchTypes";

export interface ScopeTarget {
  scope: SearchScope;
  label: string;
  description: string;
}

type ChatSelection = {
  selectedChannelId: string | null;
  selectedPrivateChatId: string | null;
} | null;

// A network name can hold spaces, so an `in:` token spells them as dashes.
export const scopeToken = (label: string) => label.replace(/\s+/g, "-");

const sameName = (a: string, b: string) =>
  scopeToken(a).toLowerCase() === scopeToken(b).toLowerCase();

export function scopeServerId(scope: SearchScope): string | null {
  return scope.kind === "everywhere" ? null : scope.serverId;
}

export function scopeLabel(scope: SearchScope, servers: Server[]): string {
  if (scope.kind === "chat") return scope.target;
  if (scope.kind === "network")
    return servers.find((s) => s.id === scope.serverId)?.name ?? scope.serverId;
  return t`Everywhere`;
}

export function chatTargets(servers: Server[]): ScopeTarget[] {
  return servers.flatMap((server) =>
    [
      ...server.channels.map((channel) => channel.name),
      ...server.privateChats.map((pm) => pm.username),
    ].map(
      (target): ScopeTarget => ({
        scope: { kind: "chat", serverId: server.id, target },
        label: target,
        description: server.name,
      }),
    ),
  );
}

export function scopeTargets(servers: Server[]): ScopeTarget[] {
  return [
    ...chatTargets(servers),
    ...servers.map(
      (server): ScopeTarget => ({
        scope: { kind: "network", serverId: server.id },
        label: server.name,
        description: t`Network`,
      }),
    ),
  ];
}

// We prefer a chat on the scoped network, then any chat, then a network by name.
export function resolveInScope(
  servers: Server[],
  scope: SearchScope,
  value: string,
): SearchScope | null {
  const serverId = scopeServerId(scope);
  const targets = scopeTargets(servers);
  const found =
    targets.find(
      (target) =>
        target.scope.kind === "chat" &&
        target.scope.serverId === serverId &&
        sameName(target.label, value),
    ) ?? targets.find((target) => sameName(target.label, value));
  return found?.scope ?? null;
}

export function nicksInScope(
  servers: Server[],
  scope: SearchScope,
  savedNicks: readonly string[] = [],
): string[] {
  const serverId = scopeServerId(scope);
  const nicks = new Set<string>(savedNicks);
  for (const server of servers) {
    if (serverId && server.id !== serverId) continue;
    for (const channel of server.channels)
      for (const user of channel.users) nicks.add(user.username);
    for (const pm of server.privateChats) nicks.add(pm.username);
  }
  return [...nicks].sort((a, b) => a.localeCompare(b));
}

export function currentChatScope(
  servers: Server[],
  serverId: string | null,
  selection: ChatSelection | undefined,
): SearchScope {
  const server = servers.find((s) => s.id === serverId);
  if (!server) return { kind: "everywhere" };
  const target =
    server.channels.find((c) => c.id === selection?.selectedChannelId)?.name ??
    server.privateChats.find((pm) => pm.id === selection?.selectedPrivateChatId)
      ?.username;
  return target
    ? { kind: "chat", serverId: server.id, target }
    : { kind: "network", serverId: server.id };
}

export function isScopeOnServers(scope: SearchScope, servers: Server[]) {
  const serverId = scopeServerId(scope);
  return !serverId || servers.some((s) => s.id === serverId);
}
