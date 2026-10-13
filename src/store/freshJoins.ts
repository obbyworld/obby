// Channels the user asked to join in this session and the server has not confirmed yet.
const freshJoins = new Set<string>();

const joinKey = (serverId: string, channelName: string) =>
  `${serverId}\n${channelName.toLowerCase()}`;

export function markFreshJoin(serverId: string, channelName: string): void {
  freshJoins.add(joinKey(serverId, channelName));
}

// Returns whether the join was still waiting, and stops tracking it.
export function settleFreshJoin(
  serverId: string,
  channelName: string,
): boolean {
  return freshJoins.delete(joinKey(serverId, channelName));
}
