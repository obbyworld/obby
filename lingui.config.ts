import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "fr", "zh", "zh-TW", "pt", "de", "it", "ro", "ru", "fi", "ja", "pl", "nl", "ko", "tr", "uk", "sv", "cs"],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: [
        "**/node_modules/**",
        "<rootDir>/src/locales/**",
        "<rootDir>/src/lib/otr/vendor/**",
      ],
    },
  ],
  format: formatter({ lineNumbers: false }),
  compileNamespace: "es",
});
