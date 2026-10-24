const pendingJoins = new Set<string>();
const keyedJoins = new Set<string>();
const automaticJoins = new Set<string>();

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

export function markKeyedJoin(serverId: string, channelName: string): void {
  keyedJoins.add(joinKey(serverId, channelName));
}

export function takeKeyedJoin(serverId: string, channelName: string): boolean {
  return keyedJoins.delete(joinKey(serverId, channelName));
}

// The client also resends JOIN for every known channel after registering, so
// the mark stays until the join succeeds or the user joins the channel themselves.
export function setAutomaticJoin(
  serverId: string,
  channelName: string,
  isAutomatic: boolean,
): void {
  const key = joinKey(serverId, channelName);
  if (isAutomatic) automaticJoins.add(key);
  else automaticJoins.delete(key);
}

export function isAutomaticJoin(
  serverId: string,
  channelName: string,
): boolean {
  return automaticJoins.has(joinKey(serverId, channelName));
}

export function forgetJoins(serverId: string): void {
  for (const joins of [pendingJoins, keyedJoins, automaticJoins])
    for (const key of joins)
      if (key.startsWith(`${serverId}\n`)) joins.delete(key);
}
