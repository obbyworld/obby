# ObsidianIRC — Agent Reference

React + TypeScript + TailwindCSS + DaisyUI + Zustand + Tauri (desktop/mobile).
WebSocket-only IRC client. Tauri wraps the web app with native bindings for TCP sockets
(WebSocket-compatible wrapper), file viewing (Swift plugin on iOS/macOS via `src-tauri/plugins/`),
and share-sheet. The web build also runs standalone via Docker/Nginx.

---

## Commands — run these every time

```bash
npm run format; npm run fix:unsafe; npm run test; npm run build
```

- `format` / `fix:unsafe` — Biome lint + format (pre-commit hook does this automatically)
- `test` — Vitest, all 50 test files must pass
- `build` — TypeScript compile + Vite bundle (must be clean)

---

## Tool versions

- **JavaScript:** **Node ≥22** ([`package.json` `engines`](package.json)); **`npm install`** from the repo root.
- **Rust (Tauri):** [`rust-toolchain.toml`](rust-toolchain.toml) — **stable** + **rustfmt**/**clippy**; MSRV in [src-tauri/Cargo.toml](src-tauri/Cargo.toml).

---

## Nix

- **`nix develop`** — full dev environment (Node 22 + Tauri Linux deps + rustup). Linux only (`x86_64`/`aarch64`).
- **`nix build .#obsidianirc`** — produces `result/bin/ObsidianIRC`. When `package-lock.json` changes, run `nix run .#update-npm-deps-hash` if you have Nix locally; otherwise `update-linux-nix` in [`publish.yaml`](.github/workflows/publish.yaml) syncs the hash to `main` on version tags.
- Details: [BUILD.md — Nix (flake)](BUILD.md#nix-flake)
---

## Project Layout

```
src/
  components/
    layout/       # AppLayout, ChatArea, ChannelList, MemberList, ChatHeader, ResizableSidebar
    mobile/       # Mobile-specific variants
    message/      # MessageItem, MediaPreview, MessageAvatar, MessageReply
    ui/           # Modals, dropdowns, settings panels
  hooks/          # Custom React hooks (useScrollToBottom, useTabCompletion, …)
  lib/
    irc/
      IRCClient.ts          # IRC client class
      handlers/             # IRC protocol dispatch (one file per domain)
        index.ts            # IRC_DISPATCH table + handleMessage()
        connection.ts / messages.ts / users.ts / channels.ts
        whois.ts / metadata.ts / auth.ts / monitoring.ts
    ircClient.ts            # Singleton: `export default new IRCClient()`  ← all imports point here
    mediaProbe.ts           # HEAD/GET probing (see URL Safety below)
    mediaUtils.ts           # Media type detection + trust logic
    settings/               # Settings definitions and helpers
  store/
    index.ts                # Zustand store: state shape + all action methods
    handlers/               # Store-side IRC event subscriptions (one file per domain)
      index.ts              # registerAllHandlers(store) — called by store/index.ts
      messages.ts / users.ts / channels.ts / batches.ts
      whois.ts / metadata.ts / auth.ts / connection.ts
    helpers.ts              # generateDeterministicId(serverId, name) — uuidv5 channel/user IDs
    types.ts                # UISelections and other store-specific types
    localStorage.ts         # loadUISelections / saveUISelections
  types/
    index.ts                # Shared types: Server, Channel, Message, User, …
tests/                      # Vitest tests — mirror src/ structure
src-tauri/                  # Tauri config, Rust backend, plugins (Swift share-sheet)
```

---

## IRC Event Flow — two layers

### Layer 1: Protocol parsing (`src/lib/irc/`)

`IRCClient.handleMessage()` calls `handleMessage(ctx, serverId, raw)` from `src/lib/irc/handlers/index.ts`,
which dispatches via `IRC_DISPATCH`:

```ts
const IRC_DISPATCH: Record<string, (ctx: IRCClientContext, serverId: string, msg: ParsedMessage) => void> = {
  PRIVMSG: handlePrivmsg,
  JOIN: handleJoin,
  "332": handleRplTopic,
  // …
};
```

Each handler in `src/lib/irc/handlers/*.ts` receives `ctx: IRCClientContext` (the client instance)
and calls `ctx.triggerEvent("EVENT_NAME", payload)` to emit to the store.

**To add a new IRC command:** add a handler function to the relevant `src/lib/irc/handlers/*.ts`
file and add it to `IRC_DISPATCH` in `index.ts`.

### Layer 2: Store subscriptions (`src/store/handlers/`)

`src/store/handlers/index.ts` exports `registerAllHandlers(store: StoreApi<AppState>)`,
which is called once at the bottom of `src/store/index.ts` after `useStore` is created.

Each handler file subscribes to `ircClient` events and updates the Zustand store:

```ts
// Pattern in every src/store/handlers/*.ts
export function registerXxxHandlers(store: StoreApi<AppState>) {
  ircClient.on("EVENT", (payload) => {
    store.setState((state) => ({ /* return Partial<AppState> — no mutation */ }));
  });
}
```

**To add a new store reaction to an IRC event:** add `ircClient.on(...)` in the relevant
`src/store/handlers/*.ts` and call the new register function from `handlers/index.ts`.

**Important:** `store.setState()` callbacks must **return** `Partial<AppState>`. The store
uses Immer (`immer` package is a dependency), but the Immer middleware is not currently wired
into `create()` — direct mutation of `state` inside `setState` will silently not work.

---

## Tests

Location: `tests/` — mirrors `src/` structure.

```
tests/
  hooks/        # React hook tests (renderHook + act)
  lib/          # Pure logic tests
  store/        # Store action/handler tests
  components/   # Component integration tests
  protocol/     # IRC mode/protocol tests
  setup.ts      # Global mocks (WebSocket, window, matchMedia, RAF)
```

Run: `npm run test`. Add tests for any business logic, hooks, and media/URL handling.
`requestAnimationFrame` is mocked as `setTimeout(cb, 0)` in `tests/setup.ts` —
always cancel nested RAFs in effect cleanup to avoid post-unmount setState errors.

---

## URL Safety — never leak user IP

**Critical invariant:** only make HTTP requests (HEAD or GET) for URLs from trusted origins.
Making a request to an arbitrary external URL reveals the user's IP.

Trust levels (checked before any network request):

1. **Safe media** — server-accepted filehost or server-marked-trusted origin → probe allowed
2. **Trusted sources** — embeddable services (YouTube, etc.) from a known-safe list → probe allowed
3. **External content** — user explicitly enabled "show all external content" → probe allowed
4. **Anything else** — show a plain link, no preview, no request

Logic lives in `src/lib/mediaUtils.ts` (trust detection) and `src/lib/mediaProbe.ts`
(HEAD → GET fallback). `src/components/message/MediaPreview.tsx` is the call site.

Do not add any fetch/HEAD/GET call that bypasses this trust check.

---

## External Link Protection — never open URLs without user confirmation

**Critical invariant:** every user-visible external URL opened by the app must pass through
`ExternalLinkWarningModal` before `openExternalUrl` is called. This protects users from
accidentally opening malicious links posted in chat.

The correct pattern in any component that opens external URLs:

```tsx
const [showWarning, setShowWarning] = useState(false);

// In JSX:
<button onClick={() => setShowWarning(true)}>Open link</button>
<ExternalLinkWarningModal
  isOpen={showWarning}
  url={url}
  onConfirm={() => { openExternalUrl(url); setShowWarning(false); }}
  onCancel={() => setShowWarning(false)}
/>
```

If a child component needs to open a URL, pass an `onRequestOpen` callback prop instead of
calling `openExternalUrl` directly — the parent controls the warning modal.

Do not call `openExternalUrl` directly from any UI element without this protection.

---

## Zustand + React Gotchas

**Store action refs are unstable.** Functions from `useStore((s) => s.someAction)` change
reference on every state update. Never put them in `useEffect` dependency arrays — it causes
infinite loops. Suppress Biome with:

```tsx
// biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
useEffect(() => { … }, [depA]);
```

Same applies to `useRef` values (read `.current` inside the effect, don't list in deps).

**macOS WKWebView scroll:** when `isScrolledUp` is true, freeze the slice start index
(see `scrollUpStartRef` in `ChatArea`) — never insert elements above the viewport or WKWebView
jumps to the top of history. See `MEMORY.md` for full explanation.

**Sentinel div:** `<div ref={messagesEndRef} className="h-px">` — must have non-zero height
for WKWebView's `IntersectionObserver`.

---

## Biome — intentional dep omissions

Always add suppression comment on the line **immediately before** the hook — pre-commit
`biome --write` silently adds missing deps otherwise:

```tsx
// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>
useEffect(() => { … }, [depA]);
```

Same applies to intentionally omitted deps you want to keep out of the array (e.g. a value
that should not re-trigger the effect). The comment prevents Biome from silently adding it
back on the next lint pass.

---

## Comments

- Explain **why**, never **what** — if the code is readable, omit the comment entirely
- Keep to one line in most cases
- Write in the context of the project, not the change — a comment must make sense to someone reading the code cold, with no knowledge of what was previously there or why it was modified

---

## Internationalisation (i18n) — adding user-facing strings

All user-visible text **must** be wrapped with LinguiJS macros so it can be translated. The pre-commit hook auto-extracts new strings and re-compiles catalogs, so you only need to write the code correctly and commit — the catalog files update themselves.

### Which tool to use


| String location                                           | Macro                              | Import                                                                                            |
| --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| JSX text children (`<button>`, `<span>`, `<p>`, headings) | `<Trans>…</Trans>`                 | `import { Trans } from "@lingui/macro"`                                                           |
| JSX props: `placeholder=`, `aria-label=`, `title=`        | `t`…`` via `useLingui`             | `import { useLingui } from "@lingui/macro"` then `const { t } = useLingui()` inside the component |
| Simple `t` outside JSX (inside a render function)         | `t`…``                             | `import { t } from "@lingui/macro"`                                                               |
| Variables/interpolation                                   | `t`Hello ${name}``                 | same — placeholders become `{0}` in the PO file                                                   |
| Non-React `.ts` files (store handlers, event callbacks)   | `t`…``                             | `import { t } from "@lingui/macro"` — safe inside callbacks that fire after `i18n.activate()`     |
| Module-level constants                                    | **Do not use** `t` at module scope | `t` evaluates before `i18n.activate()` runs. Move the string inside the function body.            |


### Correct patterns

```tsx
// JSX children
<button><Trans>Save</Trans></button>

// Props with interpolation (requires useLingui inside the component)
import { useLingui } from "@lingui/macro";
const { t } = useLingui();
<input placeholder={t`Message #${channelName}`} />

// Simple t tag inside render
import { t } from "@lingui/macro";
const label = t`Settings`;

// Module-level array — WRONG (evaluates before i18n.activate):
// const ITEMS = [{ label: t`Foo` }];   ← DO NOT DO THIS

// Correct: move inside the component or convert to a function
function getItems() {
  return [{ label: t`Foo` }];
}
```

### After adding new strings — commit and you're done

The `i18n` command in `lefthook.yml` runs automatically on pre-commit whenever a `.ts`/`.tsx` file is staged:

```bash
npm run i18n:extract   # updates all .po files; new strings get empty msgstr
npm run i18n:compile   # regenerates all .mjs files
git add src/locales/   # stages the catalog changes into the same commit
```

New strings fall back to the English key at runtime until a translator fills in `msgstr`. This is safe — the app is always functional.

**Agent responsibility:** when you add new user-visible strings, you must also translate them before committing. Run `npm run i18n:extract` to see which locales have missing strings (the table shows count per locale), then fill in all empty `msgstr ""` entries across every non-English `.po` file. Do not leave `msgstr ""` in a committed state.

### Translating new strings

When a PR introduces new strings, the non-English `.po` files will have new entries with `msgstr ""`. To translate them:

1. Run `npm run i18n:extract` (or it was already run by the pre-commit hook).
2. Spawn parallel AI agents — one per target locale — with this prompt template:

```
Read /path/to/src/locales/en/messages.po and /path/to/src/locales/{locale}/messages.po.
Fill in every empty msgstr "" with a {language} translation of the corresponding msgid.
Rules:
- Keep {0}, {1} interpolation placeholders literally.
- Keep <0>, <1> JSX positional tags literally.
- Keep IRC-specific terms (WHOIS, SASL, Op, Halfop, Voice) as-is.
- Do not modify any msgid lines.
Write the complete translated file back.
```

3. Run `npm run i18n:compile` to regenerate `.mjs` files.
4. Commit `src/locales/`.

### Adding a new locale

1. Add the code to `locales` array in `lingui.config.ts`.
2. Add it to `SUPPORTED` in `src/main.tsx`.
3. Add an `<option>` in the Language `<select>` in `src/components/ui/UserSettings.tsx`.
4. Run `npm run i18n:extract` → creates the new `.po` file.
5. Translate it (see above).
6. Run `npm run i18n:compile`.

### CI checks

The `i18n` job in `.github/workflows/workflow.yaml`:

- **Fails** if source has `t`/`Trans` strings not yet extracted into `en/messages.po`.
- **Fails** if compiled `.mjs` catalogs are stale relative to their `.po` files.
- **Reports** (informational, non-blocking) how many strings are translated per locale in the job summary.

### Tests

`@lingui/react` is mocked in tests via the alias in `vite.config.ts` → `tests/mocks/lingui-react.ts`. The mock handles `I18nProvider`, `Trans` (including `values` and `components` interpolation), and `useLingui()`. When you add a new component with lingui macros, its tests work without any wrapper changes.