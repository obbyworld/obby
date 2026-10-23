import type React from "react";

export const SkeletonRow: React.FC<{
  className?: string;
  avatarClassName?: string;
}> = ({
  className = "h-14 flex items-center gap-3 px-3",
  avatarClassName = "w-8 h-8 rounded-lg",
}) => (
  <div aria-hidden="true" className={className}>
    <span
      className={`shrink-0 bg-discord-dark-400 animate-pulse ${avatarClassName}`}
    />
    <span className="flex-1 min-w-0 flex flex-col gap-1.5">
      <span className="h-3 w-1/3 rounded bg-discord-dark-400 animate-pulse" />
      <span className="h-3 w-2/3 rounded bg-discord-dark-400 animate-pulse" />
    </span>
  </div>
);
