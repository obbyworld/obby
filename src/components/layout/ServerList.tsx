import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { FaPencilAlt, FaPlus, FaRedo, FaTrash } from "react-icons/fa";
import { useLongPress } from "../../hooks/useLongPress";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import ircClient from "../../lib/ircClient";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { Server } from "../../types";
import ServerBottomSheet from "../mobile/ServerBottomSheet";

interface ServerIconProps {
  server: Server;
  isSelected: boolean;
  isShimmering: boolean;
  isTouchDevice: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReconnect: () => void;
}

const ServerIcon: React.FC<ServerIconProps> = ({
  server,
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

  const hasMentions =
    server.channels.some((ch) => ch.isMentioned) ||
    server.privateChats?.some((pc) => pc.isMentioned);

  const iconUrl = server.icon;
  const showIcon = canShowAvatarUrl(
    iconUrl,
    serverFilehosts(server),
    mediaSettings,
  );

  const getServerInitial = (s: Server): string => {
    const displayName = s.networkName || s.name;
    return displayName.charAt(0).toUpperCase();
  };

  const handleLongPress = useCallback(() => {
    if (isSelected) {
      setBottomSheetOpen(true);
    }
  }, [isSelected]);

  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, firedRef } =
    useLongPress({ onLongPress: handleLongPress });

  const handleClick = () => {
    if (firedRef.current) return;
    onSelect();
  };

  return (
    <>
      <div
        className={`
          w-12 h-12 rounded-lg flex items-center justify-center
          transition-all duration-200 cursor-pointer group relative
          ${isSelected ? "bg-discord-primary" : "bg-discord-dark-400 hover:bg-discord-primary"}
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
          <div className="absolute inset-0 bg-gray-500 bg-opacity-50 rounded-lg" />
        )}

        {(server.connectionState === "connecting" ||
          server.connectionState === "reconnecting") && (
          <FaRedo className="absolute inset-0 m-auto text-white animate-spin text-lg" />
        )}

        {server.connectionState === "disconnected" && (
          <FaRedo
            className="absolute inset-0 m-auto text-white text-lg cursor-pointer hover:text-gray-300 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onReconnect();
            }}
            title={t`Reconnect to server`}
          />
        )}

        <div
          className={`
            absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200
            ${isSelected ? "h-10" : "h-0 group-hover:h-5"}
          `}
        />
        {showIcon ? (
          <img
            src={iconUrl}
            alt={server.name}
            className="w-9 h-9 rounded-full pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="text-xl font-semibold text-white">
            {getServerInitial(server)}
          </div>
        )}

        {hasMentions && !isSelected && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-discord-dark-600" />
        )}

        {isSelected && !isTouchDevice && (
          <div className="absolute -bottom-1 -right-1 flex space-x-1 group-hover:opacity-100 opacity-0 transition-opacity duration-200">
            <button
              className="w-5 h-5 bg-discord-dark-300 hover:bg-blue-500 rounded-full flex items-center justify-center text-white text-xs shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title={t`Edit Server`}
            >
              <FaPencilAlt />
            </button>
            <button
              className="w-5 h-5 bg-discord-dark-300 hover:bg-discord-red rounded-full flex items-center justify-center text-white text-xs shadow-md"
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

        <div className="absolute top-0 left-16 bg-black text-white p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-40 pointer-events-none">
          {server.name}
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

export const ServerList: React.FC = () => {
  const { t } = useLingui();
  const {
    servers,
    ui: { selectedServerId },
    selectServer,
    toggleAddServerModal,
    deleteServer,
    toggleChannelListModal,
    reconnectServer,
    toggleEditServerModal,
  } = useStore();

  const [shimmeringServers, setShimmeringServers] = useState<Set<string>>(
    new Set(),
  );
  const isTouchDevice = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    const handleServerReady = ({ serverId }: { serverId: string }) => {
      setShimmeringServers((prev) => new Set(prev).add(serverId));

      setTimeout(() => {
        setShimmeringServers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(serverId);
          return newSet;
        });
      }, 1000);
    };

    ircClient.on("ready", handleServerReady);
  }, []);

  return (
    <div className="pt-3 pb-6 md:pb-3 flex flex-col items-center h-full overflow-visible relative">
      {/* Home button */}
      <div
        className={`
          mb-2 w-12 h-12 rounded-lg flex items-center justify-center
          transition-all duration-200 group relative
          ${selectedServerId === null ? "bg-discord-primary " : "bg-discord-dark-400 hover:bg-discord-primary"}
        `}
        onClick={() => selectServer(null, { clearSelection: true })}
      >
        <div
          className={`
          absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200
          ${selectedServerId === null ? "h-10" : "h-0 group-hover:h-5"}
        `}
        />
        <div className="text-white text-xl">
          <img
            src="./images/obsidian.png"
            alt={t`Home`}
            className="w-full h-full rounded-lg"
          />
        </div>
        <div className="absolute top-0 left-16 bg-black text-white p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-40 pointer-events-none">
          {t`Home`}
        </div>
      </div>

      <div className="w-8 h-0.5 bg-discord-dark-100 rounded-full my-2" />

      {/* Add Server Button */}
      <div className="relative mb-2">
        <div
          className="w-12 h-12 bg-discord-dark-100 hover:bg-discord-primary/80 rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer group hover:rounded-xl"
          onClick={() => toggleAddServerModal(true)}
          data-testid="server-list-add-button"
        >
          <FaPlus className="group-hover:text-white text-2xl font-extrabold transition-colors duration-200" />
          <div className="absolute top-0 left-16 bg-black text-white p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-40 pointer-events-none">
            {t`Add Server`}
          </div>
        </div>
      </div>

      {/* Server list */}
      <div
        className="flex flex-col space-y-2 w-full items-center"
        data-testid="server-list"
      >
        {servers.map((server) => (
          <ServerIcon
            key={server.id}
            server={server}
            isSelected={selectedServerId === server.id}
            isShimmering={shimmeringServers.has(server.id)}
            isTouchDevice={isTouchDevice}
            onSelect={() => selectServer(server.id, { clearSelection: true })}
            onEdit={() => toggleEditServerModal(true, server.id)}
            onDelete={() => deleteServer(server.id)}
            onReconnect={() => reconnectServer(server.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default ServerList;
