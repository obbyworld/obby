import type React from "react";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { keepInputFocus } from "../../lib/focus";

export const CommandChip: React.FC<{ name: string }> = ({ name }) => (
  <span className="mr-1 flex h-[52px] shrink-0 items-center">
    <span className="rounded bg-discord-primary/25 px-2 py-0.5 font-mono text-sm text-discord-text-link">
      /{name}
    </span>
  </span>
);

export const CommandArgPill: React.FC<{
  label: string;
  value: string;
  optional: boolean;
  order: number;
  onSelect: () => void;
}> = ({ label, value, optional, order, onSelect }) => {
  const isTouch = useIsTouchInput();
  const tone = value
    ? "text-discord-text-normal"
    : optional
      ? "text-discord-text-muted/60"
      : "text-discord-text-muted";
  return (
    <button
      type="button"
      style={{ order }}
      onMouseDown={keepInputFocus}
      onClick={onSelect}
      className={`mr-1 max-w-full whitespace-pre-wrap break-words rounded bg-white/[0.06] px-1.5 text-left leading-[22px] hover:bg-white/10 ${isTouch ? "my-1 min-h-11 min-w-11 py-[11px]" : "my-[11px] py-1"} ${tone}`}
    >
      {value || label}
    </button>
  );
};
