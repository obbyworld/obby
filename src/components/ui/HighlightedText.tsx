import type React from "react";

export type TextRange = readonly [number, number];

export const HighlightedText: React.FC<{
  text: string;
  ranges: readonly TextRange[];
  markClassName?: string;
}> = ({
  text,
  ranges,
  markClassName = "bg-discord-primary/30 text-white rounded-sm px-px",
}) => {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={start} className={markClassName}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export default HighlightedText;
