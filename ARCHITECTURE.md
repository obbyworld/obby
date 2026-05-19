# ObsidianIRC Architecture

> **Modern IRC Client** - React + TypeScript + TailwindCSS + Tauri
> Next-generation IRC client supporting websockets only

## 🏗️ Project Structure

```
ObsidianIRC/
├── src/
│   ├── components/
│   │   ├── layout/          # Core layout components
│   │   ├── mobile/          # Mobile-specific components
│   │   └── ui/              # Reusable UI components
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Core business logic
│   ├── protocol/            # IRC protocol handlers
│   ├── store/               # State management (Zustand)
│   └── types/               # TypeScript type definitions
├── tests/                   # Test suite
├── docker/                  # Docker configuration
├── src-tauri/               # Tauri desktop app configuration
└── dist/                    # Build output
```

## 🎯 Technology Stack

### Frontend
- **React 18** - UI framework with strict mode
- **TypeScript** - Type safety and developer experience
- **TailwindCSS** - Utility-first CSS framework
- **DaisyUI** - Component library built on Tailwind
- **Zustand** - Lightweight state management
- **React Router Dom** - Client-side routing

### Build & Development
- **Vite** - Modern build tool and dev server
- **Biome** - Fast linter and formatter (replaces ESLint/Prettier)
- **Vitest** - Unit testing framework
- **Lefthook** - Git hooks management

### Deployment
- **Docker** - Containerized deployment with Nginx
- **Tauri** - Cross-platform desktop applications
- **GitHub Actions** - CI/CD pipeline

## 🧠 Core Architecture

### State Management (Zustand)
**Location:** `src/store/index.ts`

The application uses a single global store with the following structure:

```typescript
interface AppState {
  // Data
  servers: Server[]
  currentUser: User | null
  messages: Record<string, Message[]>

  // UI State
  ui: UIState
  globalSettings: GlobalSettings

  // Actions
  connect, disconnect, joinChannel, sendMessage
  selectServer, selectChannel, markChannelAsRead
  toggleModals, toggleDarkMode, etc.
}
```

**Key Features:**
- Persistent server storage in localStorage
- Real-time message caching by channel
- Optimistic UI updates

### IRC Protocol Layer
**Location:** `src/lib/ircClient.ts`

Event-driven IRC client supporting:
- WebSocket-only connections (no raw TCP)
- SASL authentication
- IRC v3 message tags
- Capability negotiation
- Multi-server management

**Event System:**
```typescript
interface EventMap {
  ready: { serverId: string; serverName: string; nickname: string }
  CHANMSG: { serverId: string; sender: string; message: string }
  JOIN, PART, QUIT, NICK: { /* user events */ }
  // ... more IRC events
}
```

### Component Architecture

#### Layout Components (`src/components/layout/`)
- **AppLayout** - Main application container
- **ServerList** - Server and channel navigation
- **ChatArea** - Message display and input
- **MemberList** - Channel user list
- **ResizableSidebar** - Collapsible sidebar layout

#### UI Components (`src/components/ui/`)
- **AddServerModal** - Server connection dialog
- **UserSettings** - User preferences
- **EmojiSelector** - Emoji picker
- **ColorPicker** - Theme customization
- **AutocompleteDropdown** - Tab completion

### Type System (`src/types/index.ts`)
Comprehensive TypeScript definitions for:
- **Server** - IRC server connection details
- **Channel** - Channel state and metadata
- **Message** - Chat message with reactions/mentions
- **User** - User profile and status
- **Command** - IRC command handlers

## 🧪 Testing Strategy

### Framework: Vitest + Testing Library
**Configuration:** `vite.config.ts` (test section)

#### Test Structure
```
tests/
├── setup.ts              # Test environment setup
├── App.test.tsx          # Integration tests
└── lib/
    └── ircClient.test.ts  # Unit tests for IRC client
```

#### Mock Strategy
- **WebSocket** - Custom MockWebSocket class
- **IRC Client** - Comprehensive event mocking
- **DOM APIs** - matchMedia, scrollIntoView mocking

#### Test Coverage
- Server connection/disconnection flows
- Message sending/receiving
- UI modal interactions
- Error handling scenarios

### Running Tests
```bash
npm run test           # Run once
npm run test:watch     # Watch mode
npm run test:ui        # Browser UI
npm run test:coverage  # Coverage report
```

## 🎨 Styling & Theming

### TailwindCSS Configuration
**File:** `tailwind.config.js`

#### Custom Design System
- **Discord-inspired colors** - Primary, secondary, background variants
- **CSS Custom Properties** - HSL-based color system
- **DaisyUI integration** - Pre-built component themes
- **Dark mode** - Class-based theme switching
- **Responsive design** - Mobile-first approach

#### Key Color Palette
```css
discord: {
  primary: "#5865F2"      /* Discord blurple */
  dark-200: "#36393F"     /* Main background */
  dark-300: "#202225"     /* Sidebar background */
  text-normal: "#DCDDDE"  /* Primary text */
}
```

## 🔧 Development Workflow

### Code Quality Tools

#### Biome Configuration (`biome.json`)
- **Linting** - Comprehensive rule set with React/TypeScript focus
- **Formatting** - Consistent code style (2-space indentation, double quotes)
- **Import organization** - Automatic import sorting
- **Accessibility** - Disabled for rapid prototyping

#### Git Hooks (`lefthook.yml`)
```yaml
pre-commit:
  commands:
    check:
      run: npx biome check --write {staged_files}
```

### Scripts Reference
```bash
# Development
npm run dev            # Start dev server (0.0.0.0:5173)
npm run build          # Production build
npm run preview        # Preview build

# Code Quality
npm run lint           # Lint and fix
npm run format         # Format code
npm run check          # Full Biome check
npm run fix            # Fix and format code
npm run fix:unsafe     # Fix with unsafe transformations

# Testing
npm run test           # Run tests
npm run test:ui        # Test UI in browser

# Hooks
npm run commit-hook-install  # Install git hooks
```

## 🚀 Deployment

### Docker Deployment
**File:** `Dockerfile`

Multi-stage build:
1. **Builder stage** — `node:22-alpine`, `npm ci`, Vite production build (`VITE_*` `ARG`s → `ENV`, see **`Dockerfile`**)
2. **Runtime stage** — Nginx Alpine serving static files

**Environment Variables (builder):**

All names below are optional `Dockerfile` **`ARG`**s (forwarded into `npm run build`). The Nix derivation accepts the same prefixes via **`viteBuildEnv`** (see **`nix/obsidianirc.nix`**).

```bash
# vite.config.ts `define`
VITE_DEFAULT_IRC_SERVER
VITE_DEFAULT_IRC_SERVER_NAME
VITE_DEFAULT_IRC_CHANNELS
VITE_HIDE_SERVER_LIST
VITE_TRUSTED_MEDIA_URLS
VITE_DEFAULT_OAUTH_PROVIDER_LABEL
VITE_DEFAULT_OAUTH_ISSUER
VITE_DEFAULT_OAUTH_CLIENT_ID
VITE_DEFAULT_OAUTH_SCOPES
VITE_DEFAULT_OAUTH_REDIRECT_URI
VITE_DEFAULT_OAUTH_TOKEN_KIND
VITE_DEFAULT_OAUTH_SERVER_PROVIDER
VITE_DEFAULT_OAUTH_AUTHORIZE_URL
VITE_DEFAULT_OAUTH_TOKEN_URL
VITE_BACKEND_URL

# Client embeds (`import.meta.env`; GIF widgets)
VITE_GIPHY_API_KEY
VITE_TENOR_API_KEY
```

### GitHub Actions CI/CD
**Files:** `.github/workflows/`

#### Workflows
1. **workflow.yaml** - Lint (Biome) + Test (Vitest)
2. **docker.yaml** - Multi-arch Docker build (amd64/arm64)
3. **github_pages.yaml** - Static site deployment
4. **cloudflare_pages.yaml** - Cloudflare Pages deployment

### Tauri Desktop Apps
Native desktop builds for:
- **macOS** - DMG installer
- **Linux** - AppImage
- **Windows** - NSIS installer
- **Mobile** - Android APK, iOS (Xcode required)

Build commands:
```bash
npm run tauri build -- --bundles dmg       # macOS
npm run tauri build -- --bundles appimage  # Linux
npm run tauri android build -- --apk       # Android
```

## 🌐 Internationalisation (i18n)

**Library:** [LinguiJS v5](https://lingui.dev) — compile-time macro approach.

### How it works

The Babel plugin (`@lingui/babel-plugin-lingui-macro`) transforms `t` and `Trans` calls at build time so there is no runtime string-parsing overhead. Compiled catalogs are lazy-loaded by locale before React mounts.

### Locale resolution order

`src/main.tsx` — `resolveLocale()`:

1. `localStorage.__dev_locale` — dev testing override (only in `import.meta.env.DEV`)
2. `localStorage.locale` — user's in-app language selection (Settings → Preferences → Language)
3. `tauriLocale()` — OS system language on all native Tauri targets (macOS, Windows, Linux, iOS, Android)
4. `navigator.language` — browser/Docker web-build fallback
5. `"en"` — final fallback if nothing matches the supported list

### Supported locales

`en es fr zh pt de it ro` — defined in `lingui.config.ts` and the `SUPPORTED` array in `src/main.tsx`.

### File layout

```
src/locales/
  {locale}/
    messages.po    # Human-readable source of truth for translators
    messages.mjs   # Compiled binary catalog (generated, do not edit)
lingui.config.ts   # Locale list, PO format, catalog paths
```

### Adding a new locale

1. Add the locale code to `locales` in `lingui.config.ts`
2. Add it to `SUPPORTED` in `src/main.tsx`
3. Add a `<option>` for it in the Language `<select>` in `src/components/ui/UserSettings.tsx`
4. Run `npm run i18n:extract` → creates `src/locales/{locale}/messages.po`
5. Fill in translations (manually or via an AI agent — see AGENTS.md)
6. Run `npm run i18n:compile` → produces `src/locales/{locale}/messages.mjs`

### Tooling scripts

| Script | Purpose |
|--------|---------|
| `npm run i18n:extract` | Scan source for `t`/`Trans` calls; update all `.po` files |
| `npm run i18n:compile` | Compile `.po` → `.mjs` for all locales |
| `npm run i18n:check` | CI check — fails if source has strings not yet extracted |

### Pre-commit automation

The `i18n` command in `lefthook.yml` runs on any staged `.ts`/`.tsx` change:

```
npm run i18n:extract && npm run i18n:compile && git add src/locales/
```

This means commits automatically stay in sync — you never need to run extract manually before committing. New strings land in non-English `.po` files as empty `msgstr ""` entries and fall back to the English key at runtime until a translator fills them in.

### Testing

`@lingui/react` is aliased to `tests/mocks/lingui-react.ts` in `vite.config.ts` during test runs. The mock provides `I18nProvider`, `Trans`, and `useLingui()` without requiring a React context provider, so component tests require no changes when strings are wrapped.

---

## 🏛️ Architectural Patterns

### Event-Driven Architecture
- IRC client emits typed events
- Components subscribe to relevant events
- Loose coupling between protocol and UI

### State Normalization
- Messages stored by `${serverId}-${channelId}` key
- Efficient lookups and updates
- Prevents data duplication

### Component Composition
- Layout components handle structure
- UI components handle interaction
- Clear separation of concerns

### Configuration Management
- Environment variables for deployment
- LocalStorage for user preferences
- Build-time configuration injection

### Security & Media Handling
- **Trusted Media Sources**: Images and media are validated against trusted sources
  - Server-specific filehost URLs (per-server configuration)
  - Global trusted media URLs (build-time configuration via `VITE_TRUSTED_MEDIA_URLS`)
  - Useful for chat bridge integrations (Matterbridge, Matrix bridges)
- **Content Display Settings**:
  - `showSafeMedia`: Display media from trusted sources only
  - `showExternalContent`: Display all external media (requires user confirmation)
- **URL Validation**: `isUrlFromTrustedSource()` validates URLs against all trusted sources

## 📋 Implementation Guidelines

### Adding New Features
1. **Define types** in `src/types/index.ts`
2. **Add store actions** in `src/store/index.ts`
3. **Create components** in appropriate `src/components/` subdirectory
4. **Write tests** following existing patterns
5. **Update protocol handlers** if IRC-related

### Testing Requirements
- Unit tests for business logic
- Integration tests for user flows
- Mock external dependencies (WebSocket, DOM APIs)
- Maintain test coverage above 80%

### Code Style
- Use Biome formatting (auto-format on save)
- Follow React/TypeScript best practices
- Prefer functional components with hooks
- Use TypeScript strict mode

### Performance Considerations
- Message virtualization for large channels
- Lazy loading for inactive channels
- Optimistic UI updates
- Efficient re-rendering with proper memoization

---

## Biome `useExhaustiveDependencies` — intentional dep omissions

When a `useEffect` intentionally omits a dependency, always add a suppression
comment on the line immediately before the hook, or the pre-commit Biome
`--write` pass will silently add it and break the intended behavior:

```tsx
// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>
useEffect(() => { ... }, [depA]);
```

Per-dep variant for partial suppression:

```tsx
// biome-ignore lint/correctness/useExhaustiveDependencies(foo): only re-run on bar change
useEffect(() => { ... }, [bar]);
```

Common legitimate omissions: `useRef` values (stable, reading `.current` should
not retrigger), Zustand store actions (may be unstable — see below).

---

## Zustand store action stability

Store action functions read via `useStore((s) => s.someAction)` may have
unstable references in this project. Do not put them in `useEffect` dependency
arrays; doing so can cause the effect to re-run on every state change. Suppress
Biome warnings with `biome-ignore` rather than adding the action to the array.

---

