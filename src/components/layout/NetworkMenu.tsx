import { t } from "@lingui/core/macro";
import type * as React from "react";
import {
  FaArrowsAltV,
  FaCog,
  FaFolderPlus,
  FaList,
  FaPowerOff,
  FaRobot,
} from "react-icons/fa";
import useStore from "../../store";
import Menu from "../ui/Menu";

interface NetworkMenuProps {
  serverId: string;
  anchor: HTMLElement | null;
  isTouch: boolean;
  onClose: () => void;
  onNewFolder: () => void;
  onReorder: () => void;
}

export function editConnection(serverId: string) {
  const store = useStore.getState();
  const server = store.servers.find((s) => s.id === serverId);
  if (server?.bouncerNetid) store.editBouncerNetwork(serverId);
  else store.toggleEditServerModal(true, serverId);
}

export const NetworkMenu: React.FC<NetworkMenuProps> = ({
  serverId,
  anchor,
  isTouch,
  onClose,
  onNewFolder,
  onReorder,
}) => {
  const store = useStore.getState();
  return (
    <Menu
      isOpen={!!anchor}
      anchorElement={anchor}
      onClose={onClose}
      menuItems={[
        {
          id: "find",
          label: t`Find channels`,
          icon: <FaList />,
          show: true,
          onClick: () => store.toggleChannelListModal(true),
        },
        {
          id: "folder",
          label: t`Create folder`,
          icon: <FaFolderPlus />,
          show: true,
          onClick: onNewFolder,
        },
        {
          id: "reorder",
          label: t`Reorder channels`,
          icon: <FaArrowsAltV />,
          show: isTouch,
          onClick: onReorder,
        },
        {
          id: "bots",
          label: t`See bots`,
          icon: <FaRobot />,
          show: true,
          onClick: () => store.requestBotsModalOpen(serverId, ""),
        },
        {
          id: "edit",
          label: t`Edit connection`,
          icon: <FaCog />,
          show: true,
          divider: true,
          onClick: () => editConnection(serverId),
        },
        {
          id: "disconnect",
          label: t`Disconnect`,
          icon: <FaPowerOff />,
          show: true,
          danger: true,
          onClick: () => store.requestDeleteServer(serverId),
        },
      ]}
    />
  );
};

export default NetworkMenu;
