import type { RecentPlace } from "../../../lib/search/recents";
import { serializeSearchQuery } from "../../../lib/search/searchQuery";
import { isScopeOnServers, scopeLabel } from "../../../lib/search/searchScope";
import type { SearchQuery } from "../../../lib/search/searchTypes";
import type { Server } from "../../../types";
import type { QuickActionResult } from "./types";

const MAX_UNREAD = 15;
const MENTION_SCORE = 1000;
const UNREAD_SCORE = 500;
const SERVER_MENTION_SCORE = 800;

type Selection = {
  selectedChannelId: string | null;
  selectedPrivateChatId: string | null;
} | null;

export function buildRecentResults(
  searches: SearchQuery[],
  places: RecentPlace[],
  servers: Server[],
): QuickActionResult[] {
  const searchResults = searches.flatMap(
    (search, index): QuickActionResult[] =>
      isScopeOnServers(search.scope, servers)
        ? [
            {
              type: "recent-search",
              id: `recent-search-${index}`,
              title: serializeSearchQuery(search),
              description: scopeLabel(search.scope, servers),
              score: 0,
              data: search,
            },
          ]
        : [],
  );
  const placeResults = places.flatMap((place, index): QuickActionResult[] => {
    const server = servers.find((s) => s.id === place.serverId);
    if (!server) return [];
    return [
      {
        type: "recent-place",
        id: `recent-place-${index}`,
        title: place.name,
        description: server.name,
        serverId: server.id,
        score: 0,
        data: place,
      },
    ];
  });
  return [...searchResults, ...placeResults];
}

export function buildUnreadResults(
  servers: Server[],
  currentServerId: string | null,
  currentSelection: Selection,
): QuickActionResult[] {
  const results: QuickActionResult[] = [];
  for (const server of servers) {
    const isCurrentServer = server.id === currentServerId;

    for (const channel of server.channels) {
      const isSelected =
        isCurrentServer && currentSelection?.selectedChannelId === channel.id;
      if (isSelected || channel.unreadCount === 0) continue;
      results.push({
        type: "channel",
        id: `channel-${server.id}-${channel.id}`,
        title: channel.name,
        description: `${server.name}${channel.topic ? ` - ${channel.topic}` : ""}`,
        serverId: server.id,
        score:
          (channel.isMentioned ? MENTION_SCORE : UNREAD_SCORE) +
          channel.unreadCount,
        data: channel,
      });
    }

    for (const pm of server.privateChats) {
      const isSelected =
        isCurrentServer && currentSelection?.selectedPrivateChatId === pm.id;
      if (isSelected || pm.unreadCount === 0) continue;
      results.push({
        type: "dm",
        id: `dm-${server.id}-${pm.id}`,
        title: pm.username,
        description: server.name,
        serverId: server.id,
        score: (pm.isMentioned ? MENTION_SCORE : UNREAD_SCORE) + pm.unreadCount,
        data: pm,
      });
    }

    const mentioned = [...server.channels, ...server.privateChats].filter(
      (chat) => chat.isMentioned,
    );
    if (mentioned.length > 0 && !isCurrentServer)
      results.push({
        type: "server",
        id: `server-${server.id}`,
        title: server.name,
        description: server.host,
        serverId: server.id,
        score:
          SERVER_MENTION_SCORE +
          mentioned.reduce((sum, chat) => sum + chat.unreadCount, 0),
        data: server,
      });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, MAX_UNREAD);
}
