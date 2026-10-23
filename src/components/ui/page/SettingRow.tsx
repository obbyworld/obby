import type React from "react";
import { type ReactNode, useId } from "react";

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-6 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-primary/60 disabled:opacity-50 ${
      checked ? "bg-discord-primary" : "bg-discord-dark-500"
    }`}
  >
    <span
      className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-[left] duration-150 ${
        checked ? "left-[19px]" : "left-[3px]"
      }`}
    />
  </button>
);

// One row of a settings card: text on the left, an inline control or a
// one-line field on the right, and anything taller (lists, sliders) stacked
// under the text. A control or field too wide to sit beside the text wraps
// under it on a phone.
export const SettingRow: React.FC<{
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  field?: ReactNode;
  children?: ReactNode;
}> = ({ id, title, description, control, field, children }) => {
  const titleId = useId();
  return (
    <div
      id={id ? `setting-${id}` : undefined}
      className="setting-row px-3 py-3 transition-colors duration-300"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-[1_1_12rem] min-w-0 flex flex-col gap-0.5">
          <span id={titleId} className="text-[15px] text-white">
            {title}
          </span>
          {description && (
            <span className="text-[13px] text-discord-text-muted">
              {description}
            </span>
          )}
        </div>
        {control}
        {field && (
          <fieldset aria-labelledby={titleId} className="setting-field">
            {field}
          </fieldset>
        )}
      </div>
      {children && (
        <fieldset aria-labelledby={titleId} className="mt-3 min-w-0">
          {children}
        </fieldset>
      )}
    </div>
  );
};

export const SettingGroup: React.FC<{
  title?: ReactNode;
  children: ReactNode;
}> = ({ title, children }) => (
  <section className="flex flex-col gap-2">
    {title && <h2 className="section-label px-1 pt-0 pb-0">{title}</h2>}
    <div className="page-card">{children}</div>
  </section>
);
