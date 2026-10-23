import { create } from "zustand";
import { channelFolders as storage } from "./localStorage";
import type { ChannelFolder, ChannelFoldersMap } from "./types";

interface ChannelFoldersState {
  folders: ChannelFoldersMap;
  createFolder: (
    serverId: string,
    name: string,
    channelName?: string,
  ) => string;
  renameFolder: (serverId: string, folderId: string, name: string) => void;
  deleteFolder: (serverId: string, folderId: string) => void;
  moveChannelToFolder: (
    serverId: string,
    channelName: string,
    folderId: string | null,
  ) => void;
  toggleFolderCollapsed: (serverId: string, folderId: string) => void;
  moveFolder: (serverId: string, folderId: string, offset: -1 | 1) => void;
  setFolders: (serverId: string, folders: ChannelFolder[]) => void;
}

const withoutChannel = (folder: ChannelFolder, channelName: string) => ({
  ...folder,
  channels: folder.channels.filter(
    (name) => name.toLowerCase() !== channelName.toLowerCase(),
  ),
});

export const useChannelFolders = create<ChannelFoldersState>((set, get) => {
  const update = (
    serverId: string,
    change: (folders: ChannelFolder[]) => ChannelFolder[],
  ) => {
    const folders = {
      ...get().folders,
      [serverId]: change(get().folders[serverId] ?? []),
    };
    storage.save(folders);
    set({ folders });
  };

  return {
    folders: storage.load(),

    createFolder: (serverId, name, channelName) => {
      const id = crypto.randomUUID();
      update(serverId, (folders) => [
        ...(channelName
          ? folders.map((f) => withoutChannel(f, channelName))
          : folders),
        {
          id,
          name,
          channels: channelName ? [channelName] : [],
          collapsed: false,
        },
      ]);
      return id;
    },

    renameFolder: (serverId, folderId, name) =>
      update(serverId, (folders) =>
        folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
      ),

    deleteFolder: (serverId, folderId) =>
      update(serverId, (folders) => folders.filter((f) => f.id !== folderId)),

    moveChannelToFolder: (serverId, channelName, folderId) =>
      update(serverId, (folders) =>
        folders.map((f) => {
          const rest = withoutChannel(f, channelName);
          return f.id === folderId
            ? { ...rest, channels: [...rest.channels, channelName] }
            : rest;
        }),
      ),

    toggleFolderCollapsed: (serverId, folderId) =>
      update(serverId, (folders) =>
        folders.map((f) =>
          f.id === folderId ? { ...f, collapsed: !f.collapsed } : f,
        ),
      ),

    moveFolder: (serverId, folderId, offset) =>
      update(serverId, (folders) => {
        const from = folders.findIndex((f) => f.id === folderId);
        const to = from + offset;
        if (from === -1 || to < 0 || to >= folders.length) return folders;
        const moved = [...folders];
        [moved[from], moved[to]] = [moved[to], moved[from]];
        return moved;
      }),

    setFolders: (serverId, folders) => update(serverId, () => folders),
  };
});
