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
function hostedPwaPlugin(env: Record<string, string>): Plugin {
  const hosted = env.VITE_HIDE_SERVER_LIST === 'true';
  const networkName = env.VITE_DEFAULT_IRC_SERVER_NAME || 'ObsidianIRC';
  const shortName = networkName.length > 12 ? networkName.slice(0, 12) : networkName;
  return {
    name: 'hosted-pwa',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      if (!hosted) return html;
      const tags = [
        '<link rel="manifest" href="/manifest.webmanifest" />',
        '<link rel="apple-touch-icon" href="/pwa/icon-192.png" />',
        `<meta name="apple-mobile-web-app-title" content="${shortName.replace(/"/g, '&quot;')}" />`,
        '<meta name="apple-mobile-web-app-capable" content="yes" />',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
        '<meta name="mobile-web-app-capable" content="yes" />',
      ].join('\n  ');
      return html.replace('</head>', `  ${tags}\n</head>`);
    },
    generateBundle() {
      if (!hosted) return;
      const manifest = {
        name: networkName,
        short_name: shortName,
        description: `${networkName} chat`,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#202225',
        background_color: '#202225',
        // Chrome's installability check on Android demands at least one
        // 192x192 AND one 512x512 icon with purpose=any. The maskable
        // variant is what Android picks when the launcher mask is
        // applied (adaptive icons); without it the artwork gets clipped
        // by the dynamic mask. See web.dev/install-criteria/ and
        // web.dev/maskable-icon/.
        icons: [
          {
            src: '/pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      };
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
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
      '__DEFAULT_IRC_SERVER__': JSON.stringify(process.env.VITE_DEFAULT_IRC_SERVER),
      '__DEFAULT_IRC_SERVER_NAME__': JSON.stringify(process.env.VITE_DEFAULT_IRC_SERVER_NAME),
      '__DEFAULT_IRC_CHANNELS__': process.env.VITE_DEFAULT_IRC_CHANNELS ? process.env.VITE_DEFAULT_IRC_CHANNELS.replace(/^['"]|['"]$/g, '').split(',').map(ch => ch.trim()) : [],
      '__HIDE_SERVER_LIST__': process.env.VITE_HIDE_SERVER_LIST === 'true',
      '__DEFAULT_OAUTH_PROVIDER_LABEL__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_PROVIDER_LABEL),
      '__DEFAULT_OAUTH_ISSUER__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_ISSUER),
      '__DEFAULT_OAUTH_CLIENT_ID__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_CLIENT_ID),
      '__DEFAULT_OAUTH_SCOPES__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_SCOPES),
      '__DEFAULT_OAUTH_REDIRECT_URI__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_REDIRECT_URI),
      '__DEFAULT_OAUTH_TOKEN_KIND__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_TOKEN_KIND),
      '__DEFAULT_OAUTH_SERVER_PROVIDER__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_SERVER_PROVIDER),
      '__DEFAULT_OAUTH_AUTHORIZE_URL__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_AUTHORIZE_URL),
      '__DEFAULT_OAUTH_TOKEN_URL__': JSON.stringify(process.env.VITE_DEFAULT_OAUTH_TOKEN_URL),
      '__BACKEND_URL__': JSON.stringify(process.env.VITE_BACKEND_URL || 'http://localhost:8080'),
      '__TRUSTED_MEDIA_URLS__': process.env.VITE_TRUSTED_MEDIA_URLS ? process.env.VITE_TRUSTED_MEDIA_URLS.replace(/^['"]|['"]$/g, '').split(',').map(url => url.trim()) : [],
    },
    // prevent vite from obscuring rust errors
    clearScreen: false,
    // Tauri expects a fixed port, fail if that port is not available
    server: {
      strictPort: true,
      cors: true,
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
