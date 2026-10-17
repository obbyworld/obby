import { t } from "@lingui/core/macro";
import type * as React from "react";
import {
  FaArrowsAltV,
  FaBell,
  FaBellSlash,
  FaCheck,
  FaCopy,
  FaFolder,
  FaFolderMinus,
  FaFolderOpen,
  FaFolderPlus,
  FaInfoCircle,
  FaPenAlt,
  FaSignOutAlt,
  FaUserPlus,
} from "react-icons/fa";
import { findFolderOf } from "../../lib/channelFolders";
import ircClient from "../../lib/ircClient";
import { hasOpPermission } from "../../lib/ircUtils";
import { toggleNotificationSound } from "../../lib/notificationVolume";
import useStore from "../../store";
import { useChannelFolders } from "../../store/channelFolders";
import type { Channel } from "../../types";
import Menu, { type MenuItem } from "../ui/Menu";

interface ChannelContextMenuProps {
  serverId: string;
  channel: Channel;
  anchor: HTMLElement | null;
  onClose: () => void;
  onInvite: () => void;
  onOpenSettings: () => void;
  onNewFolder: (folderId: string) => void;
  onReorder?: () => void;
}

const NO_FOLDERS: never[] = [];

export const ChannelContextMenu: React.FC<ChannelContextMenuProps> = ({
  serverId,
  channel,
  anchor,
  onClose,
  onInvite,
  onOpenSettings,
  onNewFolder,
  onReorder,
}) => {
  const markChannelAsRead = useStore((state) => state.markChannelAsRead);
  const leaveChannel = useStore((state) => state.leaveChannel);
  const isSoundOn = useStore(
    (state) => state.globalSettings.notificationVolume > 0,
  );
  const folders = useChannelFolders(
    (state) => state.folders[serverId] ?? NO_FOLDERS,
  );
  const { createFolder, moveChannelToFolder } = useChannelFolders.getState();

  const currentFolder = findFolderOf(folders, channel.name);
  const me = ircClient.getCurrentUser(serverId);
  const isOp = hasOpPermission(
    channel.users.find((u) => u.username === me?.username)?.status,
  );

  const folderItems: MenuItem[] = [
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      icon: folder.id === currentFolder?.id ? <FaCheck /> : <FaFolder />,
      onClick: () => moveChannelToFolder(serverId, channel.name, folder.id),
    })),
    {
      id: "new",
      label: t`Create folder`,
      icon: <FaFolderPlus />,
      divider: folders.length > 0,
      onClick: () =>
        onNewFolder(createFolder(serverId, t`new folder`, channel.name)),
    },
    {
      id: "out",
      label: t`Take out of folder`,
      icon: <FaFolderMinus />,
      show: !!currentFolder,
      onClick: () => moveChannelToFolder(serverId, channel.name, null),
    },
  ];

  const menuItems: MenuItem[] = [
    {
      id: "read",
      label: t`Mark as read`,
      icon: <FaCheck />,
      show: channel.unreadCount > 0 || !!channel.isMentioned,
      onClick: () => markChannelAsRead(serverId, channel.id),
    },
    {
      id: "sound",
      label: isSoundOn ? t`Mute notifications` : t`Enable notifications`,
      icon: isSoundOn ? <FaBellSlash /> : <FaBell />,
      onClick: toggleNotificationSound,
    },
    {
      id: "invite",
      label: t`Invite user`,
      icon: <FaUserPlus />,
      divider: true,
      onClick: onInvite,
    },
    {
      id: "settings",
      label: isOp ? t`Edit channel settings` : t`See channel info`,
      icon: isOp ? <FaPenAlt /> : <FaInfoCircle />,
      onClick: onOpenSettings,
    },
    {
      id: "copy",
      label: t`Copy channel name`,
      icon: <FaCopy />,
      onClick: () => navigator.clipboard?.writeText(channel.name),
    },
    {
      id: "folder",
      label: t`Move to folder`,
      icon: <FaFolderOpen />,
      divider: true,
      submenu: folderItems,
    },
    {
      id: "reorder",
      label: t`Reorder channels`,
      icon: <FaArrowsAltV />,
      show: !!onReorder,
      onClick: onReorder,
    },
    {
      id: "leave",
      label: t`Leave channel`,
      icon: <FaSignOutAlt />,
      divider: true,
      danger: true,
      onClick: () => leaveChannel(serverId, channel.name),
    },
  ];

  return (
    <Menu
      isOpen={!!anchor}
      anchorElement={anchor}
      onClose={onClose}
      menuItems={menuItems}
      placement="side"
    />
  );
};

export default ChannelContextMenu;
