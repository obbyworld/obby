import type React from "react";
import type { ReactNode } from "react";

interface CodePanelProps {
  label: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export const CodePanel: React.FC<CodePanelProps> = ({
  label,
  meta,
  actions,
  children,
}) => (
  <div className="code-panel">
    <div className="flex items-center gap-2 pl-2.5 pr-1 py-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-discord-text-muted">
        {label}
      </span>
      {meta && (
        <span className="text-[11px] text-discord-text-muted">{meta}</span>
      )}
      <span className="flex-1" />
      {actions}
    </div>
    <div className="px-3 pb-2.5 text-xs leading-relaxed font-mono">
      {children}
    </div>
  </div>
);

export default CodePanel;
