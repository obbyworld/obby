import type { ChannelFolder } from "../store/types";

export type ChannelKind = "text" | "voice" | "stream";

export function getChannelKind(name: string): ChannelKind {
  if (name.startsWith("^")) return "voice";
  if (name.startsWith("$")) return "stream";
  return "text";
}

export function isLiveChannel(name: string): boolean {
  return getChannelKind(name) !== "text";
}

export interface ChannelGroup<T> {
  folder: ChannelFolder | null;
  channels: T[];
}

export type ChannelListEntry<T> =
  | { type: "folder"; id: string; folder: ChannelFolder }
  | { type: "channel"; id: string; channel: T };

export const folderEntryId = (folderId: string) => `folder:${folderId}`;

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function sortByChannelOrder<T extends { name: string }>(
  channels: T[],
  order: string[] | undefined,
): T[] {
  if (!order || order.length === 0) return channels;
  const rank = (name: string) =>
    order.findIndex((ordered) => sameName(ordered, name));
  return [...channels].sort((a, b) => {
    const ia = rank(a.name);
    const ib = rank(b.name);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return 0;
  });
}

export function findFolderOf(
  folders: ChannelFolder[],
  channelName: string,
): ChannelFolder | null {
  return (
    folders.find((folder) =>
      folder.channels.some((name) => sameName(name, channelName)),
    ) ?? null
  );
}

const liveLast = <T extends { name: string }>(channels: T[]) => [
  ...channels.filter((c) => !isLiveChannel(c.name)),
  ...channels.filter((c) => isLiveChannel(c.name)),
];

// We list loose channels first, then every folder (even an empty one, so users
// can drop into it), with voice and stream channels at the bottom of each group.
export function arrangeChannels<T extends { name: string }>(
  channels: T[],
  order: string[] | undefined,
  folders: ChannelFolder[],
): ChannelGroup<T>[] {
  const sorted = sortByChannelOrder(channels, order);
  const loose = sorted.filter((c) => !findFolderOf(folders, c.name));
  return [
    { folder: null, channels: liveLast(loose) },
    ...folders.map((folder) => ({
      folder,
      channels: liveLast(
        sorted.filter((c) => findFolderOf(folders, c.name)?.id === folder.id),
      ),
    })),
  ];
}

export function flattenChannelGroups<T extends { id: string }>(
  groups: ChannelGroup<T>[],
): ChannelListEntry<T>[] {
  return groups.flatMap((group): ChannelListEntry<T>[] => [
    ...(group.folder
      ? [
          {
            type: "folder" as const,
            id: folderEntryId(group.folder.id),
            folder: group.folder,
          },
        ]
      : []),
    ...group.channels.map((channel) => ({
      type: "channel" as const,
      id: channel.id,
      channel,
    })),
  ]);
}

// We read both the channel order and folder membership from the reordered
// flat list: each channel joins the nearest folder header above it.
export function readDroppedLayout<T extends { name: string }>(
  entries: ChannelListEntry<T>[],
  folders: ChannelFolder[],
): { order: string[]; folders: ChannelFolder[] } {
  const listed = entries.flatMap((e) =>
    e.type === "channel" ? [e.channel.name.toLowerCase()] : [],
  );
  // Channels we are not in right now keep their folder for when we rejoin.
  const members = new Map<string, string[]>(
    folders.map((f) => [
      f.id,
      f.channels.filter((name) => !listed.includes(name.toLowerCase())),
    ]),
  );
  const order: string[] = [];
  let currentFolderId: string | null = null;
  for (const entry of entries) {
    if (entry.type === "folder") {
      currentFolderId = entry.folder.id;
      continue;
    }
    order.push(entry.channel.name);
    if (currentFolderId) members.get(currentFolderId)?.push(entry.channel.name);
  }
  return {
    order,
    folders: folders.map((f) => ({ ...f, channels: members.get(f.id) ?? [] })),
  };
}

// We put a channel dropped onto a folder header first in that folder, from
// either direction.
export function moveDropIntoFolder(
  ids: string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (!targetId.startsWith(folderEntryId(""))) return ids;
  const rest = ids.filter((id) => id !== draggedId);
  const headerIndex = rest.indexOf(targetId);
  return [
    ...rest.slice(0, headerIndex + 1),
    draggedId,
    ...rest.slice(headerIndex + 1),
  ];
}

export interface FolderSummary {
  channelCount: number;
  mentionCount: number;
  hasUnread: boolean;
}

export function summarizeFolders<
  T extends {
    unreadCount: number;
    isMentioned?: boolean;
    mentionCount?: number;
  },
>(entries: ChannelListEntry<T>[]): Map<string, FolderSummary> {
  const summaries = new Map<string, FolderSummary>();
  let current: FolderSummary | null = null;
  for (const entry of entries) {
    if (entry.type === "folder") {
      current = { channelCount: 0, mentionCount: 0, hasUnread: false };
      summaries.set(entry.folder.id, current);
      continue;
    }
    if (!current) continue;
    const { channel } = entry;
    current.channelCount += 1;
    if (channel.isMentioned) current.mentionCount += channel.mentionCount ?? 0;
    if (channel.unreadCount > 0) current.hasUnread = true;
  }
  return summaries;
}
