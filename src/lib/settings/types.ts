import type { MessageDescriptor } from "@lingui/core";
import type { ReactNode } from "react";

/**
 * Setting value types
 */
export type SettingValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, unknown>;

/**
 * Setting control types for UI rendering
 */
export type SettingControlType =
  | "toggle"
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "color"
  | "range"
  | "textarea"
  | "radio"
  | "checkbox"
  | "date"
  | "time"
  | "file"
  | "custom";

/**
 * Setting validation rules
 */
export interface SettingValidation {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: SettingValue) => boolean | string;
}

/**
 * Setting dependencies
 */
export interface SettingDependency {
  settingId: string;
  condition: (value: SettingValue) => boolean;
}

/**
 * Individual setting definition
 */
export interface SettingDefinition {
  // Identification
  id: string;
  key: string;
  category: SettingCategory;
  subcategory?: string;

  // Display
  title: MessageDescriptor;
  description?: MessageDescriptor;
  icon?: ReactNode;
  placeholder?: MessageDescriptor;
  tooltip?: string;

  // Type and control
  type: SettingControlType;
  defaultValue: SettingValue;

  // Options for select/radio/checkbox
  options?: SettingOption[];

  // Validation
  validation?: SettingValidation;

  // Behavior
  disabled?: boolean;
  hidden?: boolean;
  dependencies?: SettingDependency[];
  onChange?: (
    value: SettingValue,
    settings: Record<string, SettingValue>,
  ) => void;
  beforeChange?: (
    value: SettingValue,
    currentValue: SettingValue,
  ) => SettingValue | null;

  // Search and filtering
  searchKeywords?: string[];
  priority?: number;
  tags?: string[];

  // Custom rendering
  customComponent?: React.ComponentType<SettingComponentProps>;

  // Range specific
  min?: number;
  max?: number;
  step?: number;
  unit?: string;

  // File specific
  accept?: string;
  multiple?: boolean;
}

/**
 * Setting option for select/radio/checkbox
 */
export interface SettingOption {
  value: string | number;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Setting categories
 */
export type SettingCategory =
  | "profile"
  | "appearance"
  | "notifications"
  | "preferences"
  | "privacy"
  | "media"
  | "account"
  | "invitations"
  | "advanced"
  | "experimental"
  | "accessibility"
  | "network"
  | "keybindings";

/**
 * Category metadata
 */
export interface CategoryMetadata {
  id: SettingCategory;
  title: string;
  description?: string;
  icon?: ReactNode;
  order: number;
  subcategories?: SubcategoryMetadata[];
}

/**
 * Subcategory metadata
 */
export interface SubcategoryMetadata {
  id: string;
  title: string;
  description?: string;
  order: number;
}

/**
 * Props for custom setting components
 */
export interface SettingComponentProps {
  setting: SettingDefinition;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Settings search result
 */
export interface SettingSearchResult {
  setting: SettingDefinition;
  score: number;
  matches: {
    title?: boolean;
    description?: boolean;
    keywords?: boolean;
    category?: boolean;
  };
}

/**
 * Settings change event
 */
export interface SettingChangeEvent {
  settingId: string;
  oldValue: SettingValue;
  newValue: SettingValue;
  timestamp: number;
  source: "user" | "system" | "sync";
}

/**
 * Settings state
 */
export interface SettingsState {
  values: Record<string, SettingValue>;
  errors: Record<string, string>;
  isDirty: boolean;
  lastChanged?: SettingChangeEvent;
}

/**
 * Settings export/import format
 */
export interface SettingsExport {
  version: string;
  timestamp: number;
  settings: Record<string, SettingValue>;
  metadata?: {
    clientVersion?: string;
    platform?: string;
    username?: string;
  };
}

/**
 * Setting group for organized display
 */
export interface SettingGroup {
  id: string;
  title: string;
  description?: string;
  settings: SettingDefinition[];
  collapsed?: boolean;
}

/**
 * Quick action for command palette
 */
export interface SettingQuickAction {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  settingId?: string;
  action: () => void;
  keywords?: string[];
  category?: string;
  shortcut?: string;
}
