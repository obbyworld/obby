import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { FaPencilAlt, FaRedo, FaTrash } from "react-icons/fa";
import { GiGlassShot } from "react-icons/gi";
import { useLongPress } from "../../hooks/useLongPress";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { Server } from "../../types";
import ServerBottomSheet from "../mobile/ServerBottomSheet";

interface BouncerServerGroupProps {
  control: Server;
  networks: Server[];
  selectedServerId: string | null;
  shimmeringServers: Set<string>;
  isTouchDevice: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onReconnect: (id: string) => void;
}

export const BouncerServerGroup: React.FC<BouncerServerGroupProps> = ({
  control,
  networks,
  selectedServerId,
  shimmeringServers,
  isTouchDevice,
  onSelect,
  onEdit,
  onDelete,
  onReconnect,
}) => {
  const sortedChildren = useMemo(
    () =>
      [...networks].sort((a, b) => {
        const an = (a.networkName || a.name || "").toLowerCase();
        const bn = (b.networkName || b.name || "").toLowerCase();
        return an.localeCompare(bn);
      }),
    [networks],
  );

  const isAnyMemberSelected =
    selectedServerId === control.id ||
    sortedChildren.some((c) => c.id === selectedServerId);

  const hasGroupMentions =
    control.channels.some((ch) => ch.isMentioned) ||
    control.privateChats?.some((pc) => pc.isMentioned) ||
    sortedChildren.some(
      (s) =>
        s.channels.some((ch) => ch.isMentioned) ||
        s.privateChats?.some((pc) => pc.isMentioned),
    );

  return (
    <div
      className={`
        relative w-12 rounded-3xl flex flex-col items-center py-2 px-1 gap-1.5
        bg-gradient-to-b from-discord-dark-300 to-discord-dark-500
        border transition-all duration-300
        ${
          isAnyMemberSelected
            ? "border-amber-300/60 shadow-[0_0_24px_-4px_rgba(252,211,77,0.45)]"
            : "border-amber-300/15 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.5)]"
        }
      `}
    >
      {sortedChildren.map((child) => (
        <GroupedAvatar
          key={child.id}
          server={child}
          isSelected={selectedServerId === child.id}
          isShimmering={shimmeringServers.has(child.id)}
          isTouchDevice={isTouchDevice}
          onSelect={() => onSelect(child.id)}
          onEdit={() => onEdit(child.id)}
          onDelete={() => onDelete(child.id)}
          onReconnect={() => onReconnect(child.id)}
        />
      ))}

      {sortedChildren.length > 0 && (
        <div className="w-7 h-px bg-amber-300/20 my-0.5" />
      )}

      <GroupedAvatar
        server={control}
        isControl
        isSelected={selectedServerId === control.id}
        isShimmering={shimmeringServers.has(control.id)}
        isTouchDevice={isTouchDevice}
        onSelect={() => onSelect(control.id)}
        onEdit={() => onEdit(control.id)}
        onDelete={() => onDelete(control.id)}
        onReconnect={() => onReconnect(control.id)}
      />

      {hasGroupMentions && !isAnyMemberSelected && (
        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-discord-dark-600 pointer-events-none" />
      )}
    </div>
  );
};

interface GroupedAvatarProps {
  server: Server;
  isControl?: boolean;
  isSelected: boolean;
  isShimmering: boolean;
  isTouchDevice: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReconnect: () => void;
}

const GroupedAvatar: React.FC<GroupedAvatarProps> = ({
  server,
  isControl,
  isSelected,
  isShimmering,
  isTouchDevice,
  onSelect,
  onEdit,
  onDelete,
  onReconnect,
}) => {
  const { t } = useLingui();
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );

  const iconUrl = server.icon;
  const showIcon = canShowAvatarUrl(
    iconUrl,
    serverFilehosts(server),
    mediaSettings,
  );

  const hasMentions =
    server.channels.some((ch) => ch.isMentioned) ||
    server.privateChats?.some((pc) => pc.isMentioned);

  const handleLongPress = useCallback(() => {
    if (isSelected) setBottomSheetOpen(true);
  }, [isSelected]);
  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, firedRef } =
    useLongPress({ onLongPress: handleLongPress });

  const handleClick = () => {
    if (firedRef.current) return;
    onSelect();
  };

  const initial = (
    (server.networkName || server.name || "").charAt(0) || "?"
  ).toUpperCase();

  // Footer control session without a draft/ICON: 50% of full-tile size
  // (w-6 = 24px) with the shotglass fallback inside.
  const controlNoIcon = isControl && !showIcon;
  const sizeBox = controlNoIcon ? "w-6 h-6" : "w-9 h-9";
  const innerImg = controlNoIcon ? "w-6 h-6" : "w-9 h-9";

  return (
    <>
      <div
        className={`
          relative ${sizeBox} rounded-full flex items-center justify-center
          transition-all duration-200 cursor-pointer group shimmer-host
          ${
            isSelected
              ? "ring-2 ring-amber-300/80 ring-offset-1 ring-offset-discord-dark-400"
              : ""
          }
          ${isShimmering ? "shimmer" : ""}
          ${isTouchDevice ? "no-touch-action no-select" : ""}
        `}
        onClick={handleClick}
        onContextMenu={isTouchDevice ? (e) => e.preventDefault() : undefined}
        {...(isTouchDevice
          ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
          : {})}
      >
        {(server.connectionState === "disconnected" ||
          server.connectionState === "connecting" ||
          server.connectionState === "reconnecting") && (
          <div className="absolute inset-0 bg-black/40 rounded-full" />
        )}

        {(server.connectionState === "connecting" ||
          server.connectionState === "reconnecting") && (
          <FaRedo className="absolute inset-0 m-auto text-white animate-spin text-sm z-10" />
        )}

        {server.connectionState === "disconnected" && (
          <FaRedo
            className="absolute inset-0 m-auto text-white text-sm cursor-pointer hover:text-gray-300 transition-colors z-10"
            onClick={(e) => {
              e.stopPropagation();
              onReconnect();
            }}
            title={t`Reconnect to server`}
          />
        )}

        {showIcon ? (
          <img
            src={iconUrl}
            alt={server.name}
            className={`${innerImg} rounded-full pointer-events-none object-cover`}
            draggable={false}
          />
        ) : controlNoIcon ? (
          <div
            className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400/30 to-amber-700/30 border border-amber-300/40 flex items-center justify-center"
            title={t`soju bouncer (control)`}
          >
            <GiGlassShot className="text-amber-200 text-sm" />
          </div>
        ) : (
          <div className="w-9 h-9 rounded-full bg-discord-dark-400 flex items-center justify-center text-sm font-semibold text-white">
            {initial}
          </div>
        )}

        {hasMentions && !isSelected && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-[1.5px] border-discord-dark-600" />
        )}

        {isSelected && !isTouchDevice && (
          <div className="absolute -bottom-1 -right-2 flex space-x-1 group-hover:opacity-100 opacity-0 transition-opacity duration-200 z-20">
            <button
              type="button"
              className="w-4 h-4 bg-discord-dark-300 hover:bg-blue-500 rounded-full flex items-center justify-center text-white text-[8px] shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title={t`Edit Server`}
            >
              <FaPencilAlt />
            </button>
            <button
              type="button"
              className="w-4 h-4 bg-discord-dark-300 hover:bg-discord-red rounded-full flex items-center justify-center text-white text-[8px] shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={t`Disconnect`}
            >
              <FaTrash />
            </button>
          </div>
        )}

        <div className="absolute top-1/2 -translate-y-1/2 left-14 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-40 pointer-events-none">
          {server.networkName || server.name}
        </div>
      </div>

      {isTouchDevice && (
        <ServerBottomSheet
          isOpen={bottomSheetOpen}
          onClose={() => setBottomSheetOpen(false)}
          serverName={server.networkName || server.name}
          onEdit={onEdit}
          onDisconnect={onDelete}
        />
      )}
    </>
  );
};

export default BouncerServerGroup;
