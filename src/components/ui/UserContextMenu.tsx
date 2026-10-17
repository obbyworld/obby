import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo } from "react";
import {
  FaBan,
  FaCheckCircle,
  FaCommentDots,
  FaExclamationTriangle,
  FaGavel,
  FaGlobe,
  FaNetworkWired,
  FaRobot,
  FaTerminal,
  FaUser,
  FaUserTimes,
} from "react-icons/fa";
import { canModerate } from "../../lib/channelStatus";
import { createIgnorePattern, isUserIgnored } from "../../lib/ignoreUtils";
import useStore from "../../store";
import type { BotCommand } from "../../types";
import Menu, { type MenuItem } from "./Menu";
import type { ModerationAction } from "./ModerationModal";

interface UserContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  username: string;
  serverId: string;
  onClose: () => void;
  onOpenPM: (username: string) => void;
  onOpenProfile?: (username: string) => void;
  currentUserStatus?: string;
  currentUsername?: string;
  onOpenModerationModal?: (action: ModerationAction) => void;
  /** Opens the slash-command param modal for a bot command picked from the submenu. */
  onPickBotCommand?: (botNick: string, command: BotCommand) => void;
}

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  isOpen,
  x,
  y,
  username,
  serverId,
  onClose,
  onOpenPM,
  onOpenProfile,
  currentUserStatus,
  currentUsername,
  onOpenModerationModal,
  onPickBotCommand,
}) => {
  const { t } = useLingui();
  const anchorPoint = useMemo(() => ({ x, y }), [x, y]);
  const server = useStore((state) =>
    state.servers.find((s) => s.id === serverId),
  );
  const botCommands = server?.botCommands?.[username.toLowerCase()] ?? null;
  const openPage = useStore((state) => state.openPage);
  const ignoreList = useStore((state) => state.globalSettings.ignoreList);
  const addToIgnoreList = useStore((state) => state.addToIgnoreList);
  const removeFromIgnoreList = useStore((state) => state.removeFromIgnoreList);

  // We close the menu whenever the mobile panel changes (swipe, channel switch).
  const mobileViewActiveColumn = useStore(
    (state) => state.ui.mobileViewActiveColumn,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on any view change only
  useEffect(() => {
    if (isOpen) onClose();
  }, [mobileViewActiveColumn]);

  const user =
    server?.channels
      .flatMap((c) => c.users)
      .find((u) => u.username === username) ||
    server?.users.find((u) => u.username === username);
  const website = user?.metadata?.url?.value || user?.metadata?.website?.value;
  const status = user?.metadata?.status?.value;
  const isBot = !!user?.isBot || user?.metadata?.bot?.value === "true";
  const isOwnUser = username === currentUsername;
  const isIgnored = isUserIgnored(username, undefined, undefined, ignoreList);
  const isModerator = canModerate(currentUserStatus) && !isOwnUser;

  const moderate = (action: ModerationAction) => () =>
    onOpenModerationModal?.(action);

  const unignore = () =>
    ignoreList
      .filter((pattern) =>
        isUserIgnored(username, undefined, undefined, [pattern]),
      )
      .forEach(removeFromIgnoreList);

  const botCommandItems: MenuItem[] = [
    {
      id: "bots-menu",
      label: t`Open bots menu`,
      icon: <FaRobot />,
      onClick: () => openPage({ kind: "bots", serverId, botNick: username }),
    },
    ...(botCommands ?? []).map((command, index) => ({
      id: `cmd-${command.name}`,
      label: <span className="font-mono">/{command.name}</span>,
      description: command.description,
      divider: index === 0,
      onClick: () => onPickBotCommand?.(username, command),
    })),
  ];

  const menuItems: MenuItem[] = [
    {
      id: "message",
      label: t`Send Message`,
      icon: <FaCommentDots />,
      onClick: () => onOpenPM(username),
    },
    {
      id: "profile",
      label: t`View Profile`,
      icon: <FaUser />,
      onClick: () => onOpenProfile?.(username),
    },
    {
      id: "bot-commands",
      label: t`Bot Commands`,
      icon: <FaTerminal />,
      trailing: botCommands?.length,
      show: isBot && !!botCommands?.length,
      submenu: botCommandItems,
    },
    {
      id: "ignore",
      label: isIgnored ? t`Unignore User` : t`Ignore User`,
      icon: isIgnored ? <FaCheckCircle /> : <FaBan />,
      danger: !isIgnored,
      show: !isOwnUser,
      onClick: isIgnored
        ? unignore
        : () => addToIgnoreList(createIgnorePattern(username)),
    },
    {
      id: "warn",
      label: t`Warn User`,
      icon: <FaExclamationTriangle />,
      show: isModerator,
      divider: true,
      onClick: moderate("warn"),
    },
    {
      id: "kick",
      label: t`Kick User`,
      icon: <FaUserTimes />,
      show: isModerator,
      onClick: moderate("kick"),
    },
    {
      id: "ban",
      label: t`Ban User`,
      icon: <FaGavel />,
      show: isModerator,
      danger: true,
      submenu: [
        {
          id: "ban-nick",
          label: t`Ban by Nickname`,
          icon: <FaUser />,
          danger: true,
          onClick: moderate("ban-nick"),
        },
        {
          id: "ban-hostmask",
          label: t`Ban by Hostmask`,
          icon: <FaNetworkWired />,
          danger: true,
          onClick: moderate("ban-hostmask"),
        },
      ],
    },
  ];

  const header = (
    <>
      <div className="section-label px-0 pt-1">{username}</div>
      {status && <div className="row-meta truncate">{status}</div>}
      {website && (
        <div className="row-meta truncate flex items-center gap-1.5">
          <FaGlobe className="flex-shrink-0" />
          {website}
        </div>
      )}
    </>
  );

  return (
    <Menu
      isOpen={isOpen}
      onClose={onClose}
      anchorElement={anchorPoint}
      menuItems={menuItems}
      header={header}
    />
  );
};

export default UserContextMenu;
