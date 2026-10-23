/**
 * Settings Library - Main exports
 */

// Registry
export { type SettingsRegistry, settingsRegistry } from "./registry";
// Types
export type {
  CategoryMetadata,
  SettingCategory,
  SettingChangeEvent,
  SettingComponentProps,
  SettingControlType,
  SettingDefinition,
  SettingDependency,
  SettingGroup,
  SettingOption,
  SettingQuickAction,
  SettingSearchResult,
  SettingsExport,
  SettingsState,
  SettingValidation,
  SettingValue,
  SubcategoryMetadata,
} from "./types";

// Hooks - Commented out until properly integrated with store
// export {
//   useSettings,
//   useSetting,
//   useSettingsSearch,
// } from './hooks/useSettings';

// Settings definitions
export {
  accountSettings,
  callSettings,
  mediaSettings,
  notificationSettings,
  preferenceSettings,
  profileSettings,
  registerAllSettings,
} from "./definitions/allSettings";

// Re-export default registry
export { default } from "./registry";
