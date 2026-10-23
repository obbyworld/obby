import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import type {
  SettingDefinition,
  SettingValue,
} from "../../../lib/settings/types";
import { TextArea, TextInput } from "../TextInput";

// Defined at module level so React sees a stable component identity across renders.
// Native <input type="file"> labels ("Choose file" / "No file chosen") render in the
// browser's language, not the app's — this custom wrapper translates them.
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
        className="py-2 px-4 rounded border-0 button-primary text-sm"
      >
        <Trans>Choose file</Trans>
      </button>
      <span className="text-sm text-discord-text-muted">
        {fileName ?? <Trans>No file chosen</Trans>}
      </span>
    </div>
  );
};

export interface SettingRendererProps {
  setting: SettingDefinition;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  error?: string;
  disabled?: boolean;
  isHighlighted?: boolean;
}

/**
 * Renders a setting field based on its type definition
 */
export const SettingRenderer: React.FC<SettingRendererProps> = ({
  setting,
  value,
  onChange,
  error,
  disabled = false,
  isHighlighted = false,
}) => {
  const { i18n } = useLingui();
  const handleChange = useCallback(
    (newValue: SettingValue) => {
      onChange(newValue);
    },
    [onChange],
  );

  // Render custom component if specified
  if (setting.customComponent) {
    const CustomComponent = setting.customComponent;
    return (
      <CustomComponent
        setting={setting}
        value={value}
        onChange={handleChange}
        error={error}
        disabled={disabled}
      />
    );
  }

  // Render based on type
  switch (setting.type) {
    case "toggle":
      return (
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => handleChange(e.target.checked)}
            disabled={disabled}
            className="mr-3 accent-discord-primary disabled:opacity-50"
          />
          <span className="text-discord-text-normal">
            {i18n._(setting.title)}
          </span>
        </label>
      );

    case "text":
      return (
        <TextInput
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={
            setting.placeholder ? i18n._(setting.placeholder) : undefined
          }
          disabled={disabled}
          className={`w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50 ${
            error ? "border-2 border-red-500" : ""
          }`}
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={value as number}
          onChange={(e) => handleChange(Number(e.target.value))}
          placeholder={
            setting.placeholder ? i18n._(setting.placeholder) : undefined
          }
          min={setting.min}
          max={setting.max}
          step={setting.step}
          disabled={disabled}
          className={`w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50 ${
            error ? "border-2 border-red-500" : ""
          }`}
        />
      );

    case "textarea":
      return (
        <TextArea
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={
            setting.placeholder ? i18n._(setting.placeholder) : undefined
          }
          disabled={disabled}
          rows={4}
          className={`w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50 ${
            error ? "border-2 border-red-500" : ""
          }`}
        />
      );

    case "select":
      return (
        <select
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50"
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
        <div className="space-y-2">
          {setting.options?.map((option) => (
            <label
              key={option.value}
              className="flex items-center cursor-pointer"
            >
              <input
                type="radio"
                value={option.value}
                checked={value === option.value}
                onChange={() => handleChange(option.value)}
                disabled={disabled || option.disabled}
                className="mr-3 accent-discord-primary disabled:opacity-50"
              />
              <div>
                <div className="text-discord-text-normal">{option.label}</div>
                {option.description && (
                  <div className="text-sm text-discord-text-muted">
                    {option.description}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      );

    case "color":
      return (
        <div className="flex items-center space-x-2">
          <input
            type="color"
            value={value as string}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className="w-12 h-8 rounded border-none cursor-pointer disabled:opacity-50"
          />
          <TextInput
            value={value as string}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={
              setting.placeholder ? i18n._(setting.placeholder) : "#000000"
            }
            disabled={disabled}
            className="flex-1 bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary disabled:opacity-50"
          />
        </div>
      );

    case "range":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <input
              type="range"
              value={value as number}
              onChange={(e) => handleChange(Number(e.target.value))}
              min={setting.min}
              max={setting.max}
              step={setting.step}
              disabled={disabled}
              className="flex-1 accent-discord-primary disabled:opacity-50"
            />
            <span className="ml-4 text-discord-text-normal font-medium">
              {String(value)}
              {setting.unit || ""}
            </span>
          </div>
        </div>
      );

    case "file":
      return (
        <FileInputField
          setting={setting}
          disabled={disabled}
          onChange={handleChange}
        />
      );

    case "custom":
      return (
        <div className="text-discord-text-muted text-sm">
          Custom renderer not implemented for {setting.id}
        </div>
      );

    default:
      return (
        <div className="text-red-400 text-sm">
          Unknown setting type: {setting.type}
        </div>
      );
  }
};

/**
 * Wrapper component for a setting with label and description
 */
export const SettingField: React.FC<{
  setting: SettingDefinition;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  error?: string;
  disabled?: boolean;
  isHighlighted?: boolean;
  showLabel?: boolean;
}> = ({
  setting,
  value,
  onChange,
  error,
  disabled,
  isHighlighted,
  showLabel = true,
}) => {
  const { i18n } = useLingui();
  return (
    <div
      id={`setting-${setting.id}`}
      className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
        isHighlighted ? "bg-yellow-400/20 ring-2 ring-yellow-400" : ""
      }`}
      style={
        isHighlighted
          ? {
              animation: "blink 0.5s ease-in-out 1",
            }
          : undefined
      }
    >
      {showLabel && (
        <div>
          <label className="block text-discord-text-normal text-sm font-medium">
            {i18n._(setting.title)}
          </label>
          {setting.description && (
            <p className="text-discord-text-muted text-xs mt-1">
              {i18n._(setting.description)}
            </p>
          )}
          {setting.tooltip && (
            <p className="text-discord-text-muted text-xs italic mt-1">
              💡 {setting.tooltip}
            </p>
          )}
        </div>
      )}
      <SettingRenderer
        setting={setting}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
        isHighlighted={isHighlighted}
      />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default SettingRenderer;
