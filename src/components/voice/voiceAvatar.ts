import React from "react";
import { useUserColor } from "../../hooks/useUserColor";

/** Deterministic hue in [0, 360) from a nick, so the same person gets
 *  the same avatar color on every tile, in the dock, and in the pop-out. */
export function avatarHue(nick: string): number {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) {
    hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export type VoiceAvatarSize = "sm" | "md" | "lg";

const SIZE_PX: Record<VoiceAvatarSize, number> = {
  sm: 32,
  md: 64,
  lg: 128,
};

export interface VoiceAvatarProps {
  nick: string;
  size?: VoiceAvatarSize;
  className?: string;
  serverId?: string;
}

export function VoiceAvatar({
  nick,
  size = "md",
  className,
  serverId,
}: VoiceAvatarProps): React.ReactElement {
  const color = useUserColor(serverId, nick);
  const px = SIZE_PX[size];
  return React.createElement(
    "div",
    {
      className: `rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ${className ?? ""}`,
      style: {
        width: px,
        height: px,
        fontSize: Math.round(px * 0.4),
        backgroundColor: color ?? `hsl(${avatarHue(nick)}, 55%, 40%)`,
        // A pick that's too light would swallow the white initial, so
        // tint it toward black rather than using it verbatim.
        boxShadow: color ? "inset 0 0 0 999px rgba(0,0,0,0.35)" : undefined,
      },
    },
    nick[0]?.toUpperCase() ?? "?",
  );
}
