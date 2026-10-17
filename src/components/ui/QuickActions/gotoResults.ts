import type { MessageDescriptor } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { voiceDisplayName } from "../../../lib/channelMentions";
import { fuzzyMatch } from "../../../lib/fuzzySearch";
import { settingsRegistry } from "../../../lib/settings";
import type { Server } from "../../../types";
import {
  type ChannelListEntry,
  getJoinChannelResults,
} from "./joinChannelResults";
import { getPageTargets, settingsSectionTitle } from "./pageTargets";
import { resultGroupTitle } from "./resultMeta";
import type { QuickActionContext, QuickActionResult } from "./types";
import { getUIActions } from "./uiActionConfig";

const MAX_RESULTS = 15;
const SELECTED_PENALTY = -20;
const SAME_SERVER_BONUS = 5;

export interface GotoInput {
  query: string;
  servers: Server[];
  channelList: Record<string, ChannelListEntry[]>;
  context: QuickActionContext;
  ownNick: string | undefined;
  translate: (descriptor: MessageDescriptor) => string;
}

// We keep each kind of result together, ordered by its best match.
export function groupResults(sorted: QuickActionResult[]): QuickActionResult[] {
  const groups = new Map<string, QuickActionResult[]>();
  for (const result of sorted) {
    const key = resultGroupTitle(result);
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].flat();
}

function placeScore(base: number, isSelected: boolean, isSameServer: boolean) {
  if (isSelected) return base + SELECTED_PENALTY;
  return isSameServer ? base + SAME_SERVER_BONUS : base;
}

export function buildGotoResults({
  query,
  servers,
  channelList,
  context,
  ownNick,
  translate,
}: GotoInput): QuickActionResult[] {
  const currentServerId = context.selectedServerId;
  const selectedChannelId = context.selectedChannel?.id;
  const selectedPrivateChat = context.selectedPrivateChat;
  const results: QuickActionResult[] = [];

  for (const settingResult of settingsRegistry.search(query, { limit: 10 })) {
    results.push({
      type: "setting",
      id: `setting-${settingResult.setting.id}`,
      title: translate(settingResult.setting.title),
      description: `${t`Settings`} › ${settingsSectionTitle(settingResult.setting.category)}`,
      score: settingResult.score,
      data: settingResult,
    });
  }

  for (const action of getUIActions()) {
    if (!action.availability(context)) continue;
    const best = [action.title, ...action.keywords]
      .map((name) => fuzzyMatch(query, name))
      .reduce((a, b) => (b.score > a.score ? b : a));
    if (!best.matches) continue;
    results.push({
      type: action.type,
      id: action.id,
      title: action.title,
      description: action.description,
      serverId: currentServerId || undefined,
      score: best.score + (action.score - 70) / 10,
      data: {
        ...action.data,
        serverId: currentServerId || undefined,
        channelId: selectedChannelId,
        privateChatId: selectedPrivateChat?.id,
        username: selectedPrivateChat?.username,
      },
    });
  }

  for (const target of getPageTargets(context)) {
    const score = Math.max(
      fuzzyMatch(query, target.title).score,
      ...target.keywords.map((kw) => fuzzyMatch(query, kw).score * 0.9),
      fuzzyMatch(query, target.path).score * 0.5,
    );
    if (score <= 0) continue;
    results.push({
      type: "page",
      id: `page-${target.id}`,
      title: target.title,
      description: target.path,
      serverId: currentServerId || undefined,
      score,
      data: target.page,
    });
  }

  for (const server of servers) {
    const isCurrentServer = server.id === currentServerId;

    const serverMatch = fuzzyMatch(query, server.name);
    if (serverMatch.matches)
      results.push({
        type: "server",
        id: `server-${server.id}`,
        title: server.name,
        description: server.host,
        serverId: server.id,
        score: serverMatch.score + (isCurrentServer ? SELECTED_PENALTY : 0),
        data: server,
      });

    for (const channel of server.channels) {
      const match = fuzzyMatch(query, channel.name);
      if (!match.matches) continue;
      results.push({
        type: "channel",
        id: `channel-${server.id}-${channel.id}`,
        title: voiceDisplayName(channel.name),
        description: `${server.name}${channel.topic ? ` - ${channel.topic}` : ""}`,
        serverId: server.id,
        score: placeScore(
          match.score,
          isCurrentServer && selectedChannelId === channel.id,
          isCurrentServer,
        ),
        data: channel,
      });
    }

    for (const pm of server.privateChats) {
      const match = fuzzyMatch(query, pm.username);
      if (!match.matches) continue;
      results.push({
        type: "dm",
        id: `dm-${server.id}-${pm.id}`,
        title: pm.username,
        description: server.name,
        serverId: server.id,
        score: placeScore(
          match.score,
          isCurrentServer && selectedPrivateChat?.id === pm.id,
          isCurrentServer,
        ),
        data: pm,
      });
    }

    if (!isCurrentServer) continue;

    results.push(
      ...getJoinChannelResults({
        query,
        serverId: server.id,
        serverName: server.name,
        joinedChannelNames: server.channels.map((ch) => ch.name),
        listEntries: channelList[server.id] || [],
        hasVoiceCapability:
          !!server.capabilities?.includes("obsidianirc/voice"),
      }),
    );

    const users = new Map<string, boolean>();
    for (const channel of server.channels)
      for (const user of channel.users) users.set(user.username, user.isOnline);
    for (const [username, isOnline] of users) {
      if (username === ownNick) continue;
      if (server.privateChats.some((pm) => pm.username === username)) continue;
      const match = fuzzyMatch(query, username);
      if (!match.matches) continue;
      results.push({
        type: "start-dm",
        id: `start-dm-${server.id}-${username}`,
        title: t`Message ${username}`,
        description: t`Start private message on ${server.name}`,
        serverId: server.id,
        score: match.score - 5 + (isOnline ? 2 : 0),
        data: { username },
      });
    }
  }

  return groupResults(
    results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS),
  );
}
