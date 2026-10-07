import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useRef, useState } from "react";
import { FaCog, FaKey, FaMoon, FaRegCopy, FaSun } from "react-icons/fa";
import { copyToClipboard } from "../../lib/clipboard";
import useStore from "../../store";
import Menu, { type MenuItem } from "../ui/Menu";

export type PresenceStatus = "online" | "away" | "offline";

interface UserPanelProps {
  serverId: string | null;
  username: string;
  avatarUrl?: string;
  status: PresenceStatus;
  awayMessage?: string;
  displayName?: string;
  customStatus?: string;
  pronouns?: string;
  networkName?: string;
  isIrcOp: boolean;
  onOpenSettings: () => void;
}

const STATUS_DOT: Record<PresenceStatus, string> = {
  online: "bg-discord-green",
  away: "bg-discord-yellow",
  offline: "bg-discord-dark-500",
};

export const UserPanel: React.FC<UserPanelProps> = ({
  serverId,
  username,
  avatarUrl,
  status,
  awayMessage,
  displayName,
  customStatus,
  pronouns,
  networkName,
  isIrcOp,
  onOpenSettings,
}) => {
  const { t } = useLingui();
  const setAway = useStore((s) => s.setAway);
  const clearAway = useStore((s) => s.clearAway);
  // We remember which address failed, so a new avatar gets its own try.
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const presenceLabel =
    status === "online"
      ? t`Online`
      : status === "away"
        ? awayMessage || t`Away`
        : t`Offline`;
  const statusLabel =
    status === "online" && customStatus ? customStatus : presenceLabel;
  const name = displayName || username;
  const wideMeta = [
    name !== username && username,
    pronouns || networkName,
  ].filter((meta): meta is string => !!meta);

  const avatar = (
    <span className="relative shrink-0">
      <span className="w-8 h-8 rounded-full bg-discord-dark-100 flex items-center justify-center overflow-hidden text-white text-sm">
        {avatarUrl && avatarUrl !== failedAvatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setFailedAvatarUrl(avatarUrl)}
          />
        ) : (
          username.charAt(0).toUpperCase()
        )}
      </span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-[3px] ring-discord-dark-300 ${STATUS_DOT[status]}`}
      />
    </span>
  );

  const menuItems: MenuItem[] = [
    {
      id: "away",
      label: t`Set yourself away`,
      icon: <FaMoon />,
      show: !!serverId && status === "online",
      onClick: () => serverId && setAway(serverId),
    },
    {
      id: "back",
      label: t`Mark yourself back`,
      icon: <FaSun />,
      show: !!serverId && status === "away",
      onClick: () => serverId && clearAway(serverId),
    },
    {
      id: "copy",
      label: t`Copy nickname`,
      icon: <FaRegCopy />,
      onClick: () => copyToClipboard(username),
    },
    {
      id: "settings",
      label: t`Open settings`,
      icon: <FaCog />,
      divider: true,
      onClick: onOpenSettings,
    },
  ];

  return (
    <div className="user-panel mt-auto mb-2 mx-2 h-[52px] shrink-0 flex items-center gap-1 rounded-lg bg-discord-dark-300 p-1 ring-1 ring-black/30">
      <button
        ref={triggerRef}
        type="button"
        data-testid="user-panel-button"
        aria-haspopup="menu"
        aria-expanded={!!menuAnchor}
        onClick={() => setMenuAnchor(menuAnchor ? null : triggerRef.current)}
        className="flex-1 min-w-0 flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-discord-dark-500/40 focus-visible:outline-none focus-visible:bg-discord-dark-500/40"
      >
        {avatar}
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm font-semibold text-white">
              {name}
            </span>
            {isIrcOp && (
              <span
                className="shrink-0 text-amber-400 text-[10px] flex"
                title={t`You are an IRC Operator`}
                role="img"
                aria-label={t`You are an IRC Operator`}
              >
                <FaKey />
              </span>
            )}
          </span>
          <span
            className={`row-meta truncate ${status === "away" ? "text-discord-yellow" : ""}`}
          >
            {statusLabel}
          </span>
        </span>
        <span className="user-panel-wide shrink-0 flex-col items-end leading-tight max-w-[45%]">
          {wideMeta.map((meta) => (
            <span key={meta} className="row-meta truncate max-w-full">
              {meta}
            </span>
          ))}
        </span>
      </button>
      <Menu
        isOpen={!!menuAnchor}
        anchorElement={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        menuItems={menuItems}
        header={
          <div className="flex items-center gap-2.5">
            {avatar}
            <span className="min-w-0 flex flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-white">
                {name}
              </span>
              <span className="row-meta truncate">{statusLabel}</span>
            </span>
          </div>
        }
      />
    </div>
  );
};

export default UserPanel;
