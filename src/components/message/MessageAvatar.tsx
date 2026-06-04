import type React from "react";
import { useState } from "react";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";

interface MessageAvatarProps {
  userId: string;
  avatarUrl?: string;
  userStatus?: string;
  pronouns?: string;
  isAway?: boolean;
  theme: string;
  showHeader: boolean;
  onClick?: (e: React.MouseEvent) => void;
  isClickable?: boolean;
  serverId?: string;
}

export const MessageAvatar: React.FC<MessageAvatarProps> = ({
  userId,
  avatarUrl,
  userStatus,
  pronouns,
  isAway,
  theme,
  showHeader,
  onClick,
  isClickable = false,
  serverId,
}) => {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const username = userId;

  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const server = serverId
    ? useStore.getState().servers.find((s) => s.id === serverId)
    : null;

  const shouldShowAvatar = canShowAvatarUrl(
    avatarUrl,
    serverFilehosts(server),
    mediaSettings,
  );

  if (!showHeader) {
    return (
      <div className="mr-4 select-none">
        <div className="w-8" />
      </div>
    );
  }

  return (
    <div
      className={`mr-4 select-none ${isClickable ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center text-white relative group/avatar">
        {shouldShowAvatar && !imageLoadFailed ? (
          <img
            src={avatarUrl}
            alt={username}
            className="w-8 h-8 rounded-full object-cover"
            onError={() => {
              setImageLoadFailed(true);
            }}
          />
        ) : (
          username.charAt(0).toUpperCase()
        )}
        {/* Presence indicator - green if here, yellow if away */}
        <div
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-discord-dark-600 ${isAway ? "bg-discord-yellow" : "bg-discord-green"}`}
        />
        {userStatus && (
          <div className="absolute -bottom-1 -left-1 bg-discord-dark-600 rounded-full p-1">
            <div className="w-3 h-3 bg-yellow-400 rounded-full flex items-center justify-center">
              <span className="text-xs">💡</span>
            </div>
          </div>
        )}
        {(userStatus || pronouns) && (
          <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none hidden group-hover/avatar:block">
            <div className="bg-discord-dark-100 ring-1 ring-white/10 text-white rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.7)] px-3 py-2 whitespace-nowrap text-sm">
              {userStatus && <span>{userStatus}</span>}
              {userStatus && pronouns && (
                <span className="text-white/40 mx-1">·</span>
              )}
              {pronouns && (
                <span className="italic text-white/70">{pronouns}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
