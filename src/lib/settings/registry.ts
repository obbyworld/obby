import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { fuzzyMatch } from "../fuzzySearch";
import type {
  CategoryMetadata,
  SettingCategory,
  SettingDefinition,
  SettingGroup,
  SettingQuickAction,
  SettingSearchResult,
  SettingValue,
} from "./types";

// Lingui generates a hashed id for every message, so a descriptor's `id` is
// something like "mVdvNU". Searching that matches nothing a person would type,
// which is why titles were never findable. We search the source text instead.
function sourceText(d: MessageDescriptor | undefined): string[] {
  return d?.message ? [d.message.toLowerCase()] : [];
}

// So somebody searching in their own language finds a setting too. Kept apart
// from the source text because the registry is built while this module is
// imported, which is before i18n.activate runs, and asking for a translation
// then throws.
function translatedText(d: MessageDescriptor | undefined): string[] {
  if (!d || !i18n.locale) return [];
  const translated = i18n._(d);
  return translated && translated !== d.id ? [translated.toLowerCase()] : [];
}

/**
 * Settings Registry - Central management for all settings definitions
 */
class SettingsRegistry {
  private settings: Map<string, SettingDefinition> = new Map();
  private categories: Map<SettingCategory, CategoryMetadata> = new Map();
  private quickActions: Map<string, SettingQuickAction> = new Map();

  constructor() {
    this.initializeCategories();
  }

  /**
   * Initialize category metadata
   */
  private initializeCategories() {
    const categories: CategoryMetadata[] = [
      {
        id: "profile",
        title: "Profile",
        description: "Manage your profile and identity",
        order: 1,
      },
      {
        id: "appearance",
        title: "Appearance",
        description: "Customize the look and feel",
        order: 2,
      },
      {
        id: "notifications",
        title: "Notifications",
        description: "Control notification preferences",
        order: 3,
      },
      {
        id: "privacy",
        title: "Privacy",
        description: "Privacy and security settings",
        order: 4,
      },
      {
        id: "media",
        title: "Media",
        description: "Media and file handling",
        order: 5,
      },
      {
        id: "calls",
        title: "Calls",
        description: "Microphone, camera, and speaker for voice calls",
        order: 5.5,
      },
      {
        id: "account",
        title: "Account",
        description: "Account management",
        order: 6,
      },
      {
        id: "advanced",
        title: "Advanced",
        description: "Advanced configuration",
        order: 7,
      },
      {
        id: "experimental",
        title: "Experimental",
        description: "Experimental features",
        order: 8,
      },
      {
        id: "accessibility",
        title: "Accessibility",
        description: "Accessibility options",
        order: 9,
      },
      {
        id: "network",
        title: "Network",
        description: "Network and connection settings",
        order: 10,
      },
      {
        id: "keybindings",
        title: "Keybindings",
        description: "Keyboard shortcuts",
        order: 11,
      },
    ];

    for (const cat of categories) {
      this.categories.set(cat.id, cat);
    }
  }

  /**
   * Register a setting definition
   */
  register(setting: SettingDefinition): void {
    this.settings.set(setting.id, setting);
  }

  /**
   * Register multiple settings
   */
  registerMany(settings: SettingDefinition[]): void {
    for (const setting of settings) {
      this.register(setting);
    }
  }

  /**
   * Unregister a setting
   */
  unregister(settingId: string): boolean {
    const setting = this.settings.get(settingId);
    if (setting) {
      this.settings.delete(settingId);
      return true;
    }
    return false;
  }

  /**
   * Get a setting definition by ID
   */
  get(settingId: string): SettingDefinition | undefined {
    return this.settings.get(settingId);
  }

  /**
   * Get all settings
   */
  getAll(): SettingDefinition[] {
    return Array.from(this.settings.values());
  }

  /**
   * Get settings by category
   */
  getByCategory(category: SettingCategory): SettingDefinition[] {
    return this.getAll().filter((setting) => setting.category === category);
  }

  /**
   * Get settings by subcategory
   */
  getBySubcategory(
    category: SettingCategory,
    subcategory: string,
  ): SettingDefinition[] {
    return this.getAll().filter(
      (setting) =>
        setting.category === category && setting.subcategory === subcategory,
    );
  }

  /**
   * Get category metadata
   */
  getCategory(category: SettingCategory): CategoryMetadata | undefined {
    return this.categories.get(category);
  }

  /**
   * Get all categories
   */
  getAllCategories(): CategoryMetadata[] {
    return Array.from(this.categories.values()).sort(
      (a, b) => a.order - b.order,
    );
  }

  /**
   * Search settings with fuzzy matching
   */
  search(
    query: string,
    options: {
      categories?: SettingCategory[];
      limit?: number;
    } = {},
  ): SettingSearchResult[] {
    const { categories, limit = 50 } = options;
    const best = (texts: string[]) =>
      Math.max(0, ...texts.map((text) => fuzzyMatch(query, text).score));

    const results: SettingSearchResult[] = [];
    for (const setting of this.settings.values()) {
      if (categories && !categories.includes(setting.category)) continue;
      if (setting.hidden) continue;

      const titleScore = best([
        ...sourceText(setting.title),
        ...translatedText(setting.title),
      ]);
      const keywordScore = best(setting.searchKeywords ?? []) * 0.9;
      // A description only counts when the query starts one of its words,
      // since loose matches inside long sentences rank noise first.
      const descriptionScore = best([
        ...sourceText(setting.description),
        ...translatedText(setting.description),
      ]);
      const usableDescriptionScore =
        descriptionScore >= 70 ? descriptionScore * 0.6 : 0;
      const categoryScore = best([setting.category]) * 0.5;

      const score = Math.max(
        titleScore,
        keywordScore,
        usableDescriptionScore,
        categoryScore,
      );
      if (score <= 0) continue;
      results.push({
        setting,
        score: Math.min(100, score + (setting.priority ?? 0)),
        matches: {
          title: titleScore > 0,
          keywords: keywordScore > 0,
          description: usableDescriptionScore > 0,
          category: categoryScore > 0,
        },
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Get settings grouped by category and subcategory
   */
  getGrouped(): Map<SettingCategory, SettingGroup[]> {
    const grouped = new Map<SettingCategory, SettingGroup[]>();

    for (const category of this.getAllCategories()) {
      const categorySettings = this.getByCategory(category.id);

      // Group by subcategory
      const subcategoryMap = new Map<string, SettingDefinition[]>();

      for (const setting of categorySettings) {
        const subcategory = setting.subcategory || "General";
        if (!subcategoryMap.has(subcategory)) {
          subcategoryMap.set(subcategory, []);
        }
        subcategoryMap.get(subcategory)?.push(setting);
      }

      // Convert to SettingGroup array
      const groups: SettingGroup[] = Array.from(subcategoryMap.entries()).map(
        ([subcategory, settings]) => ({
          id: `${category.id}-${subcategory}`,
          title: subcategory,
          settings: settings.sort(
            (a, b) => (a.priority || 0) - (b.priority || 0),
          ),
        }),
      );

      grouped.set(category.id, groups);
    }

    return grouped;
  }

  /**
   * Get default values for all settings
   */
  getDefaultValues(): Record<string, SettingValue> {
    const defaults: Record<string, SettingValue> = {};
    for (const setting of this.settings.values()) {
      defaults[setting.id] = setting.defaultValue;
    }
    return defaults;
  }

  /**
   * Validate a setting value
   */
  validate(
    settingId: string,
    value: SettingValue,
  ): { valid: boolean; error?: string } {
    const setting = this.get(settingId);
    if (!setting) {
      return { valid: false, error: t`Setting not found` };
    }

    const validation = setting.validation;
    if (!validation) {
      return { valid: true };
    }

    // Required check - allow false and 0 as valid values
    if (
      validation.required &&
      (value === null || value === undefined || value === "")
    ) {
      return { valid: false, error: t`This field is required` };
    }

    // Type-specific validation
    if (typeof value === "string") {
      if (validation.minLength && value.length < validation.minLength) {
        return {
          valid: false,
          error: t`Minimum length is ${validation.minLength}`,
        };
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        return {
          valid: false,
          error: t`Maximum length is ${validation.maxLength}`,
        };
      }
      if (validation.pattern && !validation.pattern.test(value)) {
        return { valid: false, error: t`Invalid format` };
      }
    }

    if (typeof value === "number") {
      if (validation.min !== undefined && value < validation.min) {
        return { valid: false, error: t`Minimum value is ${validation.min}` };
      }
      if (validation.max !== undefined && value > validation.max) {
        return { valid: false, error: t`Maximum value is ${validation.max}` };
      }
    }

    // Custom validation
    if (validation.custom) {
      const result = validation.custom(value);
      if (typeof result === "string") {
        return { valid: false, error: result };
      }
      if (!result) {
        return { valid: false, error: t`Invalid value` };
      }
    }

    return { valid: true };
  }

  /**
   * Register a quick action
   */
  registerQuickAction(action: SettingQuickAction): void {
    this.quickActions.set(action.id, action);
  }

  /**
   * Get all quick actions
   */
  getQuickActions(): SettingQuickAction[] {
    return Array.from(this.quickActions.values());
  }

  /**
   * Search quick actions
   */
  searchQuickActions(query: string): SettingQuickAction[] {
    const queryLower = query.toLowerCase();

    return this.getQuickActions().filter((action) => {
      return (
        action.title.toLowerCase().includes(queryLower) ||
        action.description?.toLowerCase().includes(queryLower) ||
        action.keywords?.some((k) => k.toLowerCase().includes(queryLower)) ||
        action.category?.toLowerCase().includes(queryLower)
      );
    });
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.settings.clear();
    this.quickActions.clear();
  }
}

// Create singleton instance
export const settingsRegistry = new SettingsRegistry();

// Export for type usage
export type { SettingsRegistry };

export default settingsRegistry;
