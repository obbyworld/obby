/**
 * Brand identity — single source of truth for the application name and the
 * external endpoints tied to it. A rebrand or infrastructure move should only
 * require editing this file (plus the native bundle configs that cannot import
 * TypeScript: tauri.conf.json, Android strings.xml, Info.plist, index.html).
 *
 * User-facing strings interpolate APP_NAME via i18n placeholders so the brand
 * stays out of the translation catalogs and never needs re-translating.
 */

export const APP_NAME = "Obby";

/** Canonical source repository. */
export const APP_REPO_URL = "https://github.com/obbyworld/obby";

/** Repo URL without the scheme, for inline display. */
export const APP_REPO_LABEL = APP_REPO_URL.replace(/^https?:\/\//, "");

/** Public website / landing page. */
export const APP_WEBSITE_URL = "https://hello.obby.world";

/** Contact address shown in privacy/settings. */
export const APP_SUPPORT_EMAIL = "hello@obby.world";

/** Hosted privacy policy. */
export const APP_PRIVACY_URL = `${APP_WEBSITE_URL}/privacy`;
