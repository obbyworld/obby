/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

// Single-tenant hosted deployments (VITE_HIDE_SERVER_LIST=true) ship a
// PWA manifest + service worker so the page is installable on Android/
// desktop with the configured network's name and theme. The generic
// multi-network build is a server-picker and doesn't claim a PWA identity.
// The Docker image fills the same templates when the container starts.
// Chrome's installability check needs a 192px and a 512px icon with
// purpose=any, and Android's adaptive launcher mask uses the maskable one.
function hostedPwaPlugin(env: Record<string, string>): Plugin {
  const hosted = env.VITE_HIDE_SERVER_LIST === 'true';
  const networkName = env.VITE_DEFAULT_IRC_SERVER_NAME || 'Obby';
  const shortName = networkName.slice(0, 12);
  const fill = (file: string, escape: (value: string) => string) =>
    fs
      .readFileSync(path.resolve('docker/pwa', file), 'utf8')
      .replaceAll('__NETWORK_NAME__', escape(networkName))
      .replaceAll('__SHORT_NAME__', escape(shortName));
  return {
    name: 'hosted-pwa',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      if (!hosted) return html;
      const tags = fill('head.html', (value) => value.replace(/"/g, '&quot;'));
      return html.replace('</head>', `${tags}</head>`);
    },
    generateBundle() {
      if (!hosted) return;
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: fill('manifest.webmanifest', (value) =>
          JSON.stringify(value).slice(1, -1),
        ),
      });
    },
  };
}

// A container writes these settings to /config.js when it starts, so one web
// image serves any network. The app reads each one from globalThis.__OBBY_CONFIG__,
// which src/lib/deploymentConfig.ts fills from /config.js over the build values.
const DEPLOYMENT_KEYS = [
  'VITE_DEFAULT_IRC_SERVER',
  'VITE_DEFAULT_IRC_SERVER_NAME',
  'VITE_DEFAULT_IRC_CHANNELS',
  'VITE_HIDE_SERVER_LIST',
  'VITE_DEFAULT_OAUTH_PROVIDER_LABEL',
  'VITE_DEFAULT_OAUTH_ISSUER',
  'VITE_DEFAULT_OAUTH_CLIENT_ID',
  'VITE_DEFAULT_OAUTH_SCOPES',
  'VITE_DEFAULT_OAUTH_REDIRECT_URI',
  'VITE_DEFAULT_OAUTH_TOKEN_KIND',
  'VITE_DEFAULT_OAUTH_SERVER_PROVIDER',
  'VITE_DEFAULT_OAUTH_AUTHORIZE_URL',
  'VITE_DEFAULT_OAUTH_TOKEN_URL',
];

function buildDeploymentConfig(): Record<string, unknown> {
  const channels = process.env.VITE_DEFAULT_IRC_CHANNELS;
  return {
    ...Object.fromEntries(DEPLOYMENT_KEYS.map((key) => [key, process.env[key]])),
    VITE_DEFAULT_IRC_CHANNELS: channels
      ? channels.replace(/^['"]|['"]$/g, '').split(',').map((ch) => ch.trim())
      : [],
    VITE_HIDE_SERVER_LIST: process.env.VITE_HIDE_SERVER_LIST === 'true',
  };
}

// Vitest assigns each define to globalThis, so tests get the build values
// directly and can stub them.
function deploymentDefines(): Record<string, string | undefined> {
  const config = buildDeploymentConfig();
  return Object.fromEntries(
    DEPLOYMENT_KEYS.map((key) => [
      `__${key.replace(/^VITE_/, '')}__`,
      process.env.VITEST
        ? JSON.stringify(config[key])
        : `globalThis.__OBBY_CONFIG__.${key}`,
    ]),
  );
}

// emoji-datasource ships 22 fields per record (~1.4MB); the tab-completer only
// needs 3 (unified, short_names, category). Slim it at build time via a virtual
// module so the lazy emoji chunk is ~115KB instead of 1.4MB, and it stays in
// sync with the installed dataset version (no committed copy to drift).
function emojiSlimPlugin(): Plugin {
  const virtualId = "virtual:emoji-slim";
  const resolvedId = `\0${virtualId}`;
  return {
    name: "emoji-slim",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const file = require.resolve("emoji-datasource/emoji.json");
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
        unified: string;
        short_names: string[];
        category: string;
      }>;
      const slim = data.map((e) => ({
        unified: e.unified,
        short_names: e.short_names,
        category: e.category,
      }));
      return `export default ${JSON.stringify(slim)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return {
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      hostedPwaPlugin(process.env as Record<string, string>),
      emojiSlimPlugin(),
    ],
    base: "./",
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
      include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
      alias: {
        // Replace @lingui/react with a lightweight mock so useLingui() works
        // without requiring I18nProvider in every test render tree
        "@lingui/react": path.resolve("./tests/mocks/lingui-react.ts"),
      },
    },
    define: {
      '__APP_VERSION__': JSON.stringify(process.env.npm_package_version),
      '__APP_NAME__': JSON.stringify(process.env.npm_package_name),
      '__APP_DESCRIPTION__': JSON.stringify(process.env.npm_package_description),
      '__BUILD_CONFIG__': buildDeploymentConfig(),
      ...deploymentDefines(),
      '__BACKEND_URL__': JSON.stringify(process.env.VITE_BACKEND_URL || 'http://localhost:8080'),
      // Tests must never inherit a developer's .env trusted origins, or
      // media-trust assertions become machine-dependent (green in CI, red
      // locally). Force an empty list under vitest so the global trust source
      // is deterministic; tests that need a filehost pass it explicitly.
      '__TRUSTED_MEDIA_URLS__': (mode === "test" || !!process.env.VITEST) ? [] : process.env.VITE_TRUSTED_MEDIA_URLS ? process.env.VITE_TRUSTED_MEDIA_URLS.replace(/^['"]|['"]$/g, '').split(',').map(url => url.trim()) : [],
    },
    // prevent vite from obscuring rust errors
    clearScreen: false,
    // Tauri expects a fixed port, fail if that port is not available
    server: {
      strictPort: true,
      cors: true,
      // A mobile webview loads the app from tauri.localhost, so we point its
      // hot-reload socket at a host the device can reach (e.g. the LAN IP).
      hmr: process.env.TAURI_DEV_HOST
        ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 1421 }
        : undefined,
    },
    // to access the Tauri environment variables set by the CLI with information about the current target
    envPrefix: ['VITE_', 'TAURI_PLATFORM', 'TAURI_ARCH', 'TAURI_FAMILY', 'TAURI_PLATFORM_VERSION', 'TAURI_PLATFORM_TYPE', 'TAURI_DEBUG'],
    build: {
      // Main chunk includes the full app + react-icons/fa (~35 files); gzip is ~570KB which is fine.
      chunkSizeWarningLimit: 3000,
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
      // don't minify for debug builds
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_DEBUG,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-markdown': ['marked', 'dompurify'],
            'vendor-zustand': ['zustand'],
          },
        },
      },
    }
  };
});
