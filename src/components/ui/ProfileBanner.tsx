import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import useStore from "../../store";

export const DEFAULT_ACCENT = "#5865F2";

export const isHexColor = (v: string | undefined): v is string =>
  !!v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

// The card at the top of the profile settings, drawn from the draft values so
// it previews the profile while it is being edited.
export const ProfileBanner: React.FC<{
  serverId: string;
  nickname: string;
  displayName?: string;
  avatarUrl?: string;
  color?: string;
  status?: string;
  actions?: ReactNode;
}> = ({
  serverId,
  nickname,
  displayName,
  avatarUrl,
  color,
  status,
  actions,
}) => {
  const mediaLevel = useStore((s) => s.globalSettings.mediaVisibilityLevel);
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showAvatar =
    avatarUrl !== failedUrl &&
    canShowAvatarUrl(
      avatarUrl,
      serverFilehosts(server),
      mediaLevelToSettings(mediaLevel),
    );
  const nameColor = isHexColor(color) ? color : undefined;
  const name = displayName || nickname;

  return (
    <section className="page-span rounded-xl overflow-hidden bg-discord-dark-400/30">
      <div
        className="h-24"
        style={{ background: `${nameColor ?? DEFAULT_ACCENT}66` }}
      />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-5 pb-4 -mt-10">
        <div className="w-20 h-20 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-discord-dark-400 ring-[6px] ring-discord-dark-200 text-3xl font-bold text-white">
          {showAvatar ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={() => setFailedUrl(avatarUrl ?? null)}
            />
          ) : (
            name[0]?.toUpperCase()
          )}
        </div>
        <div className="flex-[1_1_12rem] min-w-0 pb-1">
          <div
            className="text-xl font-bold text-white truncate"
            style={nameColor ? { color: nameColor } : undefined}
          >
            {name}
          </div>
          <div className="text-[13px] text-discord-text-muted truncate">
            {name !== nickname && `${nickname} · `}
            {server?.name ?? server?.host}
          </div>
          {status && (
            <div className="text-[13px] text-discord-text-normal truncate">
              {status}
            </div>
          )}
        </div>
        {actions && <div className="flex gap-2 pb-1">{actions}</div>}
      </div>
    </section>
  );
};

export default ProfileBanner;
