import type { ReactNode } from "react";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
}

/** A single track holding a small set of choices, one of them filled in. It
 *  reads as one control, which two separate buttons never do. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  disabled,
  className = "",
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-1 rounded-full bg-discord-dark-400 p-1 ${className}`}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(segment.value)}
            className={`min-h-10 flex-1 rounded-full px-3 text-sm transition-colors disabled:opacity-50 ${
              active
                ? "bg-discord-primary text-white shadow-sm"
                : "text-discord-text-muted hover:text-discord-text-normal"
            }`}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
