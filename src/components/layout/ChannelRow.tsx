import { t } from "@lingui/core/macro";
import type * as React from "react";
import { useRef, useState } from "react";
import {
  FaDesktop,
  FaEllipsisH,
  FaHashtag,
  FaLock,
  FaSpinner,
  FaVolumeUp,
} from "react-icons/fa";
import { useLongPress } from "../../hooks/useLongPress";
import { getChannelKind } from "../../lib/channelFolders";
import {
  getChannelAvatarUrl,
  getChannelDisplayName,
  mircToHtml,
  serverFilehosts,
} from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";
import type { Channel } from "../../types";

export interface DragRowProps {
  "data-draggable-item": true;
  "data-item-id": string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  className: string;
  style?: React.CSSProperties;
}

interface ChannelRowProps {
  channel: Channel;
  serverId: string;
  isSelected: boolean;
  isPrevious: boolean;
  isInCall: boolean;
  isTouch: boolean;
  hoverClass: string;
  drag?: DragRowProps;
  leading?: React.ReactNode;
  onSelect: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
}

const KindIcon: React.FC<{
  channel: Channel;
  isSelected: boolean;
  isInCall: boolean;
}> = ({ channel, isSelected, isInCall }) => {
  const kind = getChannelKind(channel.name);
  const size = isSelected ? "text-2xl" : "text-lg";
  if (kind === "voice")
    return (
      <FaVolumeUp
        className={`${size} ${isSelected || isInCall ? "text-discord-green" : ""}`}
      />
    );
  if (kind === "stream")
    return (
      <FaDesktop
        className={`${size} ${isInCall ? "text-discord-green" : isSelected ? "text-discord-primary" : ""}`}
      />
    );
  return <FaHashtag className={size} />;
};

const KindBadge: React.FC<{ name: string }> = ({ name }) => {
  const kind = getChannelKind(name);
  if (kind === "text") return null;
  return (
    <span className="absolute -right-1.5 -bottom-1 w-4 h-4 rounded-full border-2 border-discord-dark-300 bg-discord-dark-500 text-white flex items-center justify-center">
      {kind === "voice" ? (
        <FaVolumeUp className="text-[7px]" />
      ) : (
        <FaDesktop className="text-[7px]" />
      )}
    </span>
  );
};

const ChannelSubtitle: React.FC<{
  channel: Channel;
  isSelected: boolean;
  isInCall: boolean;
}> = ({ channel, isSelected, isInCall }) => {
  const displayName = channel.metadata?.["display-name"]?.value;
  const showNameBadge =
    !!displayName && displayName !== channel.name.replace(/^[#&^$]/, "");
  if (!isInCall && !showNameBadge && !channel.topic) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs truncate">
      {isInCall && (
        <span className="flex items-center gap-1 flex-shrink-0 font-semibold text-discord-green">
          <span className="w-1.5 h-1.5 rounded-full bg-discord-green" />
          {t`in call`}
        </span>
      )}
      {showNameBadge && (
        <span
          className={`bg-gray-300 text-black px-0.5 py-0 rounded font-bold whitespace-nowrap ${
            isSelected ? "text-[11px]" : "text-[9px]"
          }`}
        >
          {channel.name}
        </span>
      )}
      {showNameBadge && channel.topic && (
        <span className="text-discord-text-muted opacity-50">•</span>
      )}
      {channel.topic && (
        <span className="text-discord-text-muted truncate">
          {mircToHtml(channel.topic)}
        </span>
      )}
    </div>
  );
};

export const ChannelRow: React.FC<ChannelRowProps> = ({
  channel,
  serverId,
  isSelected,
  isPrevious,
  isInCall,
  isTouch,
  hoverClass,
  drag,
  leading,
  onSelect,
  onOpenMenu,
}) => {
  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const server = useStore((state) =>
    state.servers.find((s) => s.id === serverId),
  );
  const [avatarFailed, setAvatarFailed] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress({
    onLongPress: () => rowRef.current && onOpenMenu(rowRef.current),
  });

  const avatarUrl = getChannelAvatarUrl(channel.metadata, isSelected ? 32 : 24);
  const showAvatar =
    !avatarFailed &&
    canShowAvatarUrl(avatarUrl, serverFilehosts(server), mediaSettings);
  const mentionCount = channel.mentionCount ?? 0;

  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={rowRef}
      {...drag}
      {...(isTouch && {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
      })}
      className={`
        group px-2 py-1 mb-1 rounded-md flex items-center justify-between
        transition-all duration-200 ease-in-out shadow-sm cursor-pointer
        ${isSelected ? "bg-black text-white" : `bg-discord-dark-400/50 ${hoverClass}`}
        ${isPrevious && !isSelected ? "border-l-2 border-amber-400/70" : "border-l-2 border-transparent"}
        ${drag?.className ?? ""}
      `}
      style={
        {
          "--bg-color": isSelected ? "#000" : "rgba(47, 49, 54, 0.5)",
          ...drag?.style,
        } as React.CSSProperties
      }
      onContextMenu={(e) => {
        if (isTouch) return;
        e.preventDefault();
        onOpenMenu(e.currentTarget);
      }}
      onClick={() => {
        if (longPress.firedRef.current) {
          longPress.firedRef.current = false;
          return;
        }
        onSelect();
      }}
    >
      {leading}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="relative flex-shrink-0 flex items-center">
          {showAvatar ? (
            <>
              <img
                src={avatarUrl}
                alt={channel.name}
                className={`rounded-full object-cover ${isSelected ? "w-8 h-8" : "w-6 h-6"} ${
                  isInCall ? "ring-2 ring-discord-green" : ""
                }`}
                onError={() => setAvatarFailed(true)}
              />
              <KindBadge name={channel.name} />
            </>
          ) : (
            <KindIcon
              channel={channel}
              isSelected={isSelected}
              isInCall={isInCall}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate font-medium max-w-full">
            {getChannelDisplayName(channel.name, channel.metadata)}
          </span>
          <ChannelSubtitle
            channel={channel}
            isSelected={isSelected}
            isInCall={isInCall}
          />
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {channel.needsKey ? (
          <span
            role="img"
            title={t`Select to enter the channel key`}
            aria-label={t`Select to enter the channel key`}
          >
            <FaLock className="w-3 h-3 text-discord-yellow" />
          </span>
        ) : channel.isLoadingHistory ? (
          <FaSpinner className="w-3 h-3 text-gray-400 animate-spin" />
        ) : (
          !isSelected && (
            <span className={isTouch ? "" : "group-hover:hidden"}>
              {channel.isMentioned && mentionCount > 0 ? (
                <span className="block bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {mentionCount}
                </span>
              ) : channel.unreadCount > 0 ? (
                <span className="block w-2 h-2 bg-blue-500 rounded-full" />
              ) : null}
            </span>
          )
        )}
        {!leading && !isTouch && (
          <button
            type="button"
            className={`h-6 flex items-center justify-center overflow-hidden text-discord-text-muted hover:text-white [@container(max-width:200px)]:hidden ${
              isSelected ? "w-6" : "w-0 group-hover:w-6 focus-visible:w-6"
            }`}
            title={t`Open channel options`}
            aria-label={t`Open channel options`}
            onPointerDown={stopDrag}
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(e.currentTarget);
            }}
          >
            <FaEllipsisH className="text-sm flex-shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ChannelRow;
