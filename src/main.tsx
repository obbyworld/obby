import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { locale as tauriLocale } from "@tauri-apps/plugin-os";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/500.css";
import "@fontsource/roboto-mono/600.css";
import "@fontsource/roboto-mono/700.css";
import "@fontsource/roboto-mono/400-italic.css";
import "@fontsource/roboto-mono/700-italic.css";
import "./index.css";
import { registerHostedServiceWorker } from "./lib/registerServiceWorker";

registerHostedServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find root element");
}

// Derived at build time from the compiled locale directories — no manual list to maintain.
// When a new locale is added to lingui.config.ts and catalogs are compiled, it appears here automatically.
const catalogs = import.meta.glob("./locales/*/messages.mjs");
const SUPPORTED = Object.keys(catalogs).map((p) =>
  p.replace("./locales/", "").replace("/messages.mjs", ""),
);

function matchLocale(raw: string | null | undefined): string {
  if (!raw) return "en";
  const normalized = raw.toLowerCase().replace("_", "-");
  // Case-insensitive full match first so e.g. zh-TW beats zh
  const full = SUPPORTED.find((s) => s.toLowerCase() === normalized);
  if (full) return full;
  const lang = normalized.split("-")[0];
  return SUPPORTED.find((s) => s.toLowerCase() === lang) ?? "en";
}

async function resolveLocale(): Promise<string> {
  // Dev override: localStorage.__dev_locale = "fr" in console to test any locale
  const devOverride = import.meta.env.DEV
    ? localStorage.getItem("__dev_locale")
    : null;
  if (devOverride && SUPPORTED.includes(devOverride)) return devOverride;

  // URL param ?lang=de — highest priority, does not overwrite localStorage
  const urlLang = new URLSearchParams(window.location.search).get("lang");
  if (urlLang) {
    const matched = matchLocale(urlLang);
    if (matched !== "en" || urlLang === "en") return matched;
  }

  // User explicit preference from the in-app language switcher
  const userPref = localStorage.getItem("locale");
  if (userPref && SUPPORTED.includes(userPref)) return userPref;

  // System locale via Tauri plugin (macOS, Windows, Linux, iOS, Android)
  // Throws or returns null when running as a plain web build
  try {
    const sys = await tauriLocale();
    if (sys) return matchLocale(sys);
  } catch {
    // web build — no Tauri runtime available
  }

  // Browser locale fallback (Docker / web build)
  return matchLocale(navigator.language);
}

async function loadCatalog(locale: string) {
  const key = `./locales/${locale}/messages.mjs`;
  try {
    const { messages } = (await catalogs[key]()) as { messages: Messages };
    i18n.load(locale, messages);
    i18n.activate(locale);
  } catch {
    // Catalog missing or failed — fall back to English
    if (locale !== "en") {
      const enKey = "./locales/en/messages.mjs";
      const { messages } = (await catalogs[enKey]()) as { messages: Messages };
      i18n.load("en", messages);
      i18n.activate("en");
    }
  }
}

(async () => {
  const locale = await resolveLocale();
  await loadCatalog(locale);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </React.StrictMode>,
  );
})();
