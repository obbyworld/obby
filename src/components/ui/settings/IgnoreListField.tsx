import { XMarkIcon } from "@heroicons/react/24/solid";
import { t } from "@lingui/core/macro";
import type React from "react";
import { useState } from "react";
import { isValidIgnorePattern } from "../../../lib/ignoreUtils";
import type { SettingComponentProps } from "../../../lib/settings/types";
import { TextInput } from "../TextInput";

/**
 * Custom component for managing ignore list
 */
export const IgnoreListField: React.FC<SettingComponentProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const [newPattern, setNewPattern] = useState("");
  const [validationError, setValidationError] = useState("");
  const ignoreList = (value as string[]) || [];

  const handleAddPattern = () => {
    const trimmed = newPattern.trim();
    if (!trimmed) {
      setValidationError(t`Pattern cannot be empty`);
      return;
    }

    if (!isValidIgnorePattern(trimmed)) {
      setValidationError(
        t`Invalid pattern format. Use nick!user@host format (wildcards * allowed)`,
      );
      return;
    }

    if (ignoreList.includes(trimmed)) {
      setValidationError(t`Pattern already exists`);
      return;
    }

    onChange([...ignoreList, trimmed]);
    setNewPattern("");
    setValidationError("");
  };

  const handleRemovePattern = (pattern: string) => {
    onChange(ignoreList.filter((p) => p !== pattern));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPattern();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewPattern(e.target.value);
    setValidationError("");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex space-x-2">
          <TextInput
            value={newPattern}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            disabled={disabled}
            placeholder={t`nick!user@host (e.g., spam*!*@*, *!*@badhost.com)`}
            className={`flex-1 rounded border px-3 py-2 text-discord-text-normal placeholder-discord-text-muted focus:outline-none disabled:opacity-50 ${
              validationError
                ? "border-red-500 bg-red-900/20 focus:border-red-400"
                : "border-discord-button-secondary-default bg-discord-dark-400 focus:border-discord-text-link"
            }`}
          />
          <button
            type="button"
            onClick={handleAddPattern}
            disabled={disabled || !newPattern.trim()}
            className="rounded bg-discord-button-success-default px-4 py-2 text-white hover:bg-discord-button-success-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t`Add`}
          </button>
        </div>
        {validationError && (
          <p className="text-red-400 text-xs">{validationError}</p>
        )}
        <p className="text-discord-text-muted text-xs">
          {t`Use * for wildcards. Examples: baduser!*@*, *!*@spammer.com, troll*!*@*`}
        </p>
      </div>
      {ignoreList.length > 0 && (
        <div className="space-y-2 bg-discord-dark-400 rounded p-3">
          <p className="text-discord-text-muted text-sm font-medium">
            {t`Ignored patterns:`}
          </p>
          <div className="space-y-1">
            {ignoreList.map((pattern) => (
              <div
                key={pattern}
                className="flex items-center justify-between bg-discord-dark-500 rounded px-3 py-2"
              >
                <code className="text-discord-text-normal text-sm font-mono">
                  {pattern}
                </code>
                <button
                  type="button"
                  onClick={() => handleRemovePattern(pattern)}
                  disabled={disabled}
                  className="text-red-400 hover:text-red-300 disabled:opacity-50"
                  title={t`Remove pattern`}
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IgnoreListField;
