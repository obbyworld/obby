import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  SettingDefinition,
  SettingValue,
} from "../../../lib/settings/types";
import { SettingRow, Switch } from "../page/SettingRow";
import { TextArea, TextInput } from "../TextInput";

// The browser renders native file input labels in its own language, so we translate them here.
const FileInputField: React.FC<{
  setting: SettingDefinition;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
}> = ({ setting, disabled, onChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        accept={setting.accept}
        multiple={setting.multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setFileName(file.name);
            const reader = new FileReader();
            reader.onload = () => onChange(reader.result as string);
            reader.readAsDataURL(file);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        className="button-primary h-8 px-3 rounded-lg text-sm"
      >
        <Trans>Choose file</Trans>
      </button>
      <span className="text-sm text-discord-text-muted truncate">
        {fileName ?? <Trans>No file chosen</Trans>}
      </span>
    </div>
  );
};

// We save on blur, so each text setting is written once after the user finishes typing.
export const TextDraftInput: React.FC<{
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value, onCommit, placeholder, disabled }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      className="field-input"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
};

export interface SettingRendererProps {
  setting: SettingDefinition;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  error?: string;
  disabled?: boolean;
}

export const SettingRenderer: React.FC<SettingRendererProps> = ({
  setting,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { i18n } = useLingui();

  if (setting.customComponent) {
    const CustomComponent = setting.customComponent;
    return (
      <CustomComponent
        setting={setting}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
      />
    );
  }

  const placeholder = setting.placeholder
    ? i18n._(setting.placeholder)
    : undefined;

  switch (setting.type) {
    case "toggle":
      return (
        <Switch
          checked={value === true}
          onChange={onChange}
          label={i18n._(setting.title)}
          disabled={disabled}
        />
      );

    case "text":
      return (
        <TextDraftInput
          value={(value as string) ?? ""}
          onCommit={onChange}
          placeholder={placeholder}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className="field-input"
          value={value as number}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={placeholder}
          min={setting.min}
          max={setting.max}
          step={setting.step}
          disabled={disabled}
        />
      );

    case "textarea":
      return (
        <TextArea
          className="field-input"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={4}
        />
      );

    case "select":
      return (
        <select
          className="field-input"
          value={value as string}
          onChange={(e) =>
            onChange(
              setting.options?.find(
                (option) => String(option.value) === e.target.value,
              )?.value ?? e.target.value,
            )
          }
          disabled={disabled}
        >
          {setting.options?.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      );

    case "radio":
      return (
        <div className="flex flex-col gap-2">
          {setting.options?.map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-3 cursor-pointer"
            >
              <input
                type="radio"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                disabled={disabled || option.disabled}
                className="mt-1 accent-discord-primary disabled:opacity-50"
              />
              <span className="flex flex-col">
                <span className="text-sm text-discord-text-normal">
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-[13px] text-discord-text-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      );

    case "color":
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={(value as string) || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-10 h-9 shrink-0 rounded-lg border-none cursor-pointer bg-transparent disabled:opacity-50"
          />
          <TextInput
            className="field-input"
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? "#000000"}
            disabled={disabled}
          />
        </div>
      );

    case "range":
      return (
        <div className="flex items-center gap-4">
          <input
            type="range"
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
            min={setting.min}
            max={setting.max}
            step={setting.step}
            disabled={disabled}
            className="flex-1 accent-discord-primary disabled:opacity-50"
          />
          <span className="min-w-12 text-right text-sm font-medium tabular-nums text-discord-text-normal">
            {String(value)}
            {setting.unit || ""}
          </span>
        </div>
      );

    case "file":
      return (
        <FileInputField
          setting={setting}
          disabled={disabled}
          onChange={onChange}
        />
      );

    default:
      return null;
  }
};

export const SettingField: React.FC<{
  setting: SettingDefinition;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  error?: string;
  disabled?: boolean;
  children?: ReactNode;
}> = ({ setting, value, onChange, error, disabled, children }) => {
  const { i18n } = useLingui();
  const title = i18n._(setting.title);
  const description = setting.description
    ? i18n._(setting.description)
    : undefined;
  const renderer = (
    <SettingRenderer
      setting={setting}
      value={value}
      onChange={onChange}
      error={error}
      disabled={disabled}
    />
  );

  if (setting.type === "toggle" && !setting.customComponent) {
    return (
      <SettingRow
        id={setting.id}
        title={title}
        description={description}
        control={renderer}
      />
    );
  }

  return (
    <SettingRow id={setting.id} title={title} description={description}>
      {renderer}
      {error && <p className="mt-2 text-xs text-discord-red">{error}</p>}
      {children}
    </SettingRow>
  );
};

export default SettingRenderer;
