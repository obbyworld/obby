import { t } from "@lingui/core/macro";
import { classifyChannelName } from "../../../lib/channelMentions";
import { fuzzyMatch } from "../../../lib/fuzzySearch";
import type { QuickActionResult } from "./types";

export interface ChannelListEntry {
  channel: string;
  userCount: number;
  topic: string;
}

export interface JoinChannelResultsParams {
  query: string;
  serverId: string;
  serverName: string;
  joinedChannelNames: string[];
  listEntries: ChannelListEntry[];
  hasVoiceCapability: boolean;
}

function joinTitle(channelName: string): string {
  switch (classifyChannelName(channelName)) {
    case "voice":
      return t`Join voice channel ${channelName}`;
    case "stream":
      return t`Join stream ${channelName}`;
    default:
      return t`Join ${channelName}`;
  }
}

function listedDescription(channelName: string, userCount: number): string {
  switch (classifyChannelName(channelName)) {
    case "voice":
      return t`${userCount} in call`;
    case "stream":
      return t`${userCount} watching`;
    default:
      return t`${userCount} users`;
  }
}

function freeformDescription(channelName: string, serverName: string): string {
  switch (classifyChannelName(channelName)) {
    case "voice":
      return t`Start a voice channel on ${serverName}`;
    case "stream":
      return t`Start a stream on ${serverName}`;
    default:
      return t`Join channel on ${serverName}`;
  }
}

/** Suggests channels to join for a `#`/`^`/`$`-prefixed query: known channels
 * from the server's LIST reply that fuzzy-match, plus a free-form "join this
 * exact name" fallback. Voice (`^`) and stream (`$`) channels only surface
 * when the server negotiated the obsidianirc/voice capability — joining
 * would not work otherwise. */
export function getJoinChannelResults({
  query,
  serverId,
  serverName,
  joinedChannelNames,
  listEntries,
  hasVoiceCapability,
}: JoinChannelResultsParams): QuickActionResult[] {
  const kind = classifyChannelName(query);
  if (kind === null) return [];
  if (kind !== "text" && !hasVoiceCapability) return [];

  const results: QuickActionResult[] = [];
  const joined = new Set(joinedChannelNames.map((name) => name.toLowerCase()));
  const alreadyShown = new Set<string>();

  listEntries.forEach((entry) => {
    if (classifyChannelName(entry.channel) !== kind) return;

    const channelMatch = fuzzyMatch(query.slice(1), entry.channel.slice(1));
    if (!channelMatch.matches) return;
    if (joined.has(entry.channel.toLowerCase())) return;

    results.push({
      type: "join-channel",
      id: `join-channel-${serverId}-${entry.channel}`,
      title: joinTitle(entry.channel),
      description: `${listedDescription(entry.channel, entry.userCount)} - ${serverName}`,
      serverId,
      score: channelMatch.score + 50,
      data: { channelName: entry.channel },
    });
    alreadyShown.add(entry.channel.toLowerCase());
  });

  const channelName = query.trim();
  if (channelName.length > 1 && !alreadyShown.has(channelName.toLowerCase())) {
    results.push({
      type: "join-channel",
      id: `join-channel-${serverId}-${channelName}`,
      title: joinTitle(channelName),
      description: freeformDescription(channelName, serverName),
      serverId,
      score: 100,
      data: { channelName },
    });
  }

  return results;
}
