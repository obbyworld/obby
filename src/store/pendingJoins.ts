const pendingJoins = new Set<string>();

const joinKey = (serverId: string, channelName: string) =>
  `${serverId}\n${channelName.toLowerCase()}`;

export function markPendingJoin(serverId: string, channelName: string): void {
  pendingJoins.add(joinKey(serverId, channelName));
}

export function takePendingJoin(
  serverId: string,
  channelName: string,
): boolean {
  return pendingJoins.delete(joinKey(serverId, channelName));
}
