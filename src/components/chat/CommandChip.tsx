import type React from "react";

export const CommandChip: React.FC<{ name: string }> = ({ name }) => (
  <span className="mr-1 flex h-[52px] shrink-0 items-center">
    <span className="rounded bg-discord-primary/25 px-2 py-0.5 font-mono text-sm text-discord-text-link">
      /{name}
    </span>
  </span>
);
