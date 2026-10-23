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

const SKELETON_ROW_IDS = [0, 1, 2];
const FILL_ROW_IDS = Array.from({ length: 30 }, (_, id) => id);

// We fill the rest of the parent with isFilling so a loading chat shows no bare space.
export const MessageSkeletons: React.FC<{
  rowClassName?: string;
  avatarClassName?: string;
  isFilling?: boolean;
}> = ({
  rowClassName = "flex items-start gap-4 px-4 py-2",
  avatarClassName = "w-8 h-8 rounded-full",
  isFilling = false,
}) => {
  const rows = (ids: number[]) =>
    ids.map((id) => (
      <SkeletonRow
        key={id}
        className={rowClassName}
        avatarClassName={avatarClassName}
      />
    ));
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col gap-0.5 blur-[1px] ${isFilling ? "grow" : ""}`}
    >
      {rows(SKELETON_ROW_IDS)}
      {isFilling && (
        <div className="grow basis-0 overflow-hidden flex flex-col gap-0.5">
          {rows(FILL_ROW_IDS)}
        </div>
      )}
    </div>
  );
};
