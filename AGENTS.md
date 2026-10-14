# Obby — Agent Reference

React + TypeScript + TailwindCSS + DaisyUI + Zustand + Tauri (desktop/mobile).
WebSocket-only IRC client. Tauri wraps the web app with native bindings for TCP sockets
(WebSocket-compatible wrapper), file viewing (Swift plugin on iOS/macOS via `src-tauri/plugins/`),
and share-sheet. The web build also runs standalone via Docker/Nginx.

---

## The CI gate: run before every push

CI ([`workflow.yaml`](.github/workflows/workflow.yaml)) runs these, and all must pass. Each one ends
with `git diff --exit-code`, so a hook that rewrites a file fails the job:

| Command                                                                    | What it checks                      |
| -------------------------------------------------------------------------- | ----------------------------------- |
| `npx lefthook run pre-commit --commands check --all-files`                 | Biome lint, format and import order |
| `npx lefthook run pre-commit --commands i18n --all-files`                  | Lingui catalogs extracted, compiled |
| `npx lefthook run pre-commit --commands docs-format,docs-lint --all-files` | Prettier and markdownlint on docs   |
| `npx lefthook run pre-commit --commands rust-fmt,rust-clippy --all-files`  | `src-tauri/` and the plugins        |
| `npm run test`                                                             | Vitest                              |

- Read `npm run test`'s exit code: an unhandled error fails the run while every test passes.
- Only `biome check` sorts imports, so `npm run format` alone leaves drift the Biome job catches.

CI does not run these, so run them yourself when the change touches them:

- `npm run build` (`tsc -b` and Vite). A type error passes every CI job above.
- swift-format, for the Swift plugin sources (macOS only, through the pre-commit hook).
- A native app build (`npx tauri build`), for anything under `src-tauri/`.

---

## Tool versions

- **JavaScript:** **Node ≥22** ([`package.json` `engines`](package.json)); **`npm install`** from the repo root.
- **Rust (Tauri):** [`rust-toolchain.toml`](rust-toolchain.toml) — **stable** + **rustfmt**/**clippy**; MSRV in [src-tauri/Cargo.toml](src-tauri/Cargo.toml).

---

## Nix

- **`nix develop`** — full dev environment (Node 22 + Tauri Linux deps + rustup). Linux only (`x86_64`/`aarch64`).
- **`nix build .#obby`** — produces `result/bin/Obby`. When `package-lock.json` changes, run `nix run .#update-npm-deps-hash` if you have Nix locally; otherwise `update-linux-nix` in [`publish.yaml`](.github/workflows/publish.yaml) syncs the hash to `main` on version tags.
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
    ircClient.ts            # Singleton: `export default new IRCClient()`  ← all imports point here
    mediaProbe.ts           # HEAD/GET probing (see URL Safety below)
    mediaUtils.ts           # Media type detection + trust logic
    settings/               # Every user setting: add one in definitions/; the settings page and search read the registry
  store/
    index.ts                # Zustand store: state shape + all action methods
    handlers/               # Store-side IRC event subscriptions (one file per domain)
      index.ts              # registerAllHandlers(store) — called by store/index.ts
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
const IRC_DISPATCH: Record<
  string,
  (ctx: IRCClientContext, serverId: string, msg: ParsedMessage) => void
> = {
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
    store.setState((state) => ({/* return Partial<AppState> — no mutation */}));
  });
}
```

**To add a new store reaction to an IRC event:** add `ircClient.on(...)` in the relevant
`src/store/handlers/*.ts` and call the new register function from `handlers/index.ts`.

**Important:** `store.setState()` callbacks must **return** `Partial<AppState>`. The store
uses Immer (`immer` package is a dependency), but the Immer middleware is not currently wired
into `create()` — direct mutation of `state` inside `setState` will silently not work.

### What real servers do

Servers differ from the spec and from each other (UnrealIRCd/ObbyIRCd, Ergo, InspIRCd, bouncers).
Write the code for what they actually send:

- Read server behaviour from ISUPPORT (`IRCClient` keeps the values per server): history page size from `CHATHISTORY`, channel prefixes from `CHANTYPES`.
- A channel name starts with any character in `CHANTYPES` (`#`, `&`, `+`, `!`, …). Test it with `ircClient.isChannel(serverId, name)`, or `isChannelTarget(name)` where no server is known, never against `#` alone. A `#` the user types (a completion trigger, a URL fragment) stays a literal character.
- Compare channel names and nicks case-insensitively.
- A field the server has not sent yet is `undefined`, a different state from its empty or zero value (`readMarker === undefined` means the server has not answered). Gate on whether the field arrived.
- With `echo-message`, the server's echo is the copy of our own message we show.
- A `CAP` reply can span several lines, each marked `*` until the last one. Decide on the merged
  capability set after the final line.
- A short `CHATHISTORY` page is normal. Only an empty reply means there is no older history.
- One account can hold several sessions at once. A second login to the same network is a server
  entry of its own, and anything keyed by address also needs the login.
- Settings pages send only the fields the user edited, so values set from another session survive.

When you say something works on IRC, name the server you checked it against. "The spec says X" is a separate
claim.

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

Test a decision with fixed inputs. When it depends on randomness, extract it into a pure function
and test that, so the test gives the same result on every run.

Unit tests cover the logic. Check behaviour against a live server too: the local stack in
[CONTRIBUTING.md](CONTRIBUTING.md#testing-environment) runs one. Most bugs here only show up in these
cases:

- two accounts: one posts while the other is away, then the second reads
- a page reload, and a second session of the same account
- a reconnect, and a server that refuses the action (a join, a capability)
- the next interaction after the first: open each picker, sheet and menu, pick something, and check
  where focus and the keyboard end up
- the whole window after a visual change: each column keeps its own background, nothing scrolls
  sideways, long nicks, topics and TLS strings wrap

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

## Credentials: long-lived secrets go only to the IRCd

**Critical invariant:** a long-lived credential (the SASL or server password, a personal
access token, a client certificate key) is sent only to the IRC server the user logs in to.
Never send one to a file host, an API or any other HTTP endpoint, even one the server
advertises, and even over https.

A service that needs to know who the user is gets a short-lived, single-purpose token
minted by the IRCd: `draft/authtoken` (`TOKEN GENERATE <service>`, one token per request).
The vendor `obby.world/FILEHOST` uploader works this way.

- `draft/FILEHOST` hosts are passwordless: POST the file with no credentials.
- We do not support `soju.im/FILEHOST`, since it logs in to the file host with the IRC
  credentials. See https://github.com/obbyworld/obby/issues/203#issuecomment-4512606251.

---

## Untrusted content

Anything new that runs or unpacks content from chat (an iframe, a message bus, an uploaded archive)
ships with its threat model written down: what a malicious file can reach. An iframe gets `sandbox`,
a CSP with `connect-src 'none'`, and a `postMessage` handler that checks `event.source` (see
`EmbedPlayer`).

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
jumps to the top of history.

**WebKit media:** probe a media URL once and share the in-flight probe. Many concurrent probes that
create and cancel `<video>`/`<audio>` elements deadlock the WebKit GPU process and freeze the Mac app.

**Sentinel div:** `<div ref={messagesEndRef} className="h-px">` — must have non-zero height
for WKWebView's `IntersectionObserver`.

---

## UI conventions

- Temporary activity (uploads, media playback, bot workflows) lives in the strip under the chat header, one line per row with details behind an expand control. The end of the chat and the composer stay clear.
- Each action has one entry point. Before adding a button, check whether the menu or toolbar beside it already offers the action.
- Colours come from the `discord-*` theme tokens and icons from `react-icons`. `LoadingSpinner` marks a blocking wait. Work with a known size shows a real progress bar.
- Touch targets are at least 44px (`w-11 h-11`) when `useIsTouchInput()` is true.
- UI text is imperative and names the action the reader takes: buttons, hints, empty states, toasts and errors ("no comments yet, `c` to add").
- A request to move or restyle one element changes that element only.
- Dropdown menus go through `Menu` (`src/components/ui/Menu.tsx`); other floating panels go through `Popover`. Style their contents with the shared classes in the `@layer components` block of `src/index.css` (`surface-floating`, `row-interactive`, `row-meta`, …) so every panel stays one look.
- Hover hints use one look, the `tooltip-surface` class. A plain `title` attribute is enough: `TitleTooltipLayer` shows it in that style. Wrap richer content in `HoverTooltip`, and never style a tooltip by hand.
- Touch UI (bottom sheets, long-press, drag handles) follows `useIsTouchInput()`. Window width only decides layout, so a narrow desktop window still gets mouse UI.
- Lists that suggest completions above the chat input (members, emojis, slash commands) render through `SuggestionList` and take their arrow, Enter and Escape keys from `useSuggestionKeys`.
- Bottom sheets build on `BottomSheet` with the `sheet-row` and `sheet-action` classes; taps and holds go through `useShortTap` and `useLongPress`, which share one delay so they never fire together.
- Never call `window.confirm`, `window.alert` or `window.prompt`: the Tauri webview on macOS and iOS returns without showing anything. Ask with `confirmDestructive` or build the dialog on `ConfirmDialog` (`src/lib/modal/ConfirmDialog.tsx`); every dialog built on `BaseModal` closes on a click outside.
- Stray typing goes to the chat input. An open modal dialog takes it for its own text field, and an inline editor can claim it with `useTypingOwner`.

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

- Explain **why**, never **what**. If the code is readable, omit the comment entirely. A clearer name or an extracted function usually replaces the comment
- One line: a full plain sentence in first person plural that names who does what ("so we have to replay the request from the server")
- Write in the context of the project, not the change — a comment must make sense to someone reading the code cold, with no knowledge of what was previously there or why it was modified
- State the general reason the code exists, the one any user on any platform shares. The tool, setup or report that exposed the need belongs in the conversation, outside the code
- State what the code does now, affirmatively, with no contrast against an older or alternative behaviour

---

## Platforms

Obby ships as a web app and as Tauri apps for macOS, Windows, Linux, iOS and Android. A change in
`src-tauri/` or behind `isTauri()` covers all five:

- Read what the plugin or crate does on each OS, and split with `#[cfg(target_os = …)]` where an OS
  needs its own handling.
- `cargo check --target aarch64-apple-ios` compiles the non-macOS branches on a Mac.
- Rebuild the native app and try the change there. The Tauri webview behaves differently from Chrome
  (see the WebKit notes and the `window.confirm` rule above).

---

## Git and pull requests

- Commit and push only when asked.
- A commit message is one line, a conventional commit with a scope: `fix(join): keep saved channels when an autojoin is refused`.
- A PR body opens with what users saw broken, in one or two plain sentences, and links the spec it follows. A before/after diagram (mermaid) is welcome. The reviewer reads the diff, so the body leaves out file and function lists.
- Commits, PRs, comments and docs describe the bug for any server running the code. They name no user, nick, account, server or deployment, and carry no AI attribution.

---

## Internationalisation (i18n) — adding user-facing strings

All user-visible text **must** be wrapped with LinguiJS macros so it can be translated. The pre-commit hook auto-extracts new strings and re-compiles catalogs, so you only need to write the code correctly and commit — the catalog files update themselves.

### Which tool to use

| String location                                           | Macro                              | Import                                                                                              |
| --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| JSX text children (`<button>`, `<span>`, `<p>`, headings) | `<Trans>…</Trans>`                 | `import { Trans } from "@lingui/react/macro"`                                                       |
| JSX props: `placeholder=`, `aria-label=`, `title=`        | `` t`…` `` via `useLingui`         | `import { useLingui } from "@lingui/react/macro"` then `const { t } = useLingui()` in the component |
| Simple `t` outside JSX (inside a render function)         | `` t`…` ``                         | `import { t } from "@lingui/core/macro"`                                                            |
| Variables/interpolation                                   | `` t`Hello ${name}` ``             | same — placeholders become `{0}` in the PO file                                                     |
| Non-React `.ts` files (store handlers, event callbacks)   | `` t`…` ``                         | `import { t } from "@lingui/core/macro"` — safe inside callbacks that fire after `i18n.activate()`  |
| Module-level constants                                    | **Do not use** `t` at module scope | `t` evaluates before `i18n.activate()` runs. Move the string inside the function body.              |
| Strings stored in state and rendered later                | **Store a code, not prose**        | Translate at the render site — see below.                                                           |

### Never put English prose in state

A string written into the store and rendered by a component later cannot be
translated: the macro never sees it, so a non-English user reads a translated
sentence with an untranslated English clause spliced into it. Store a code and
translate where it renders.

```ts
// WRONG — the reason reaches the UI as raw English
dispatch(serverId, nick, { type: "error", reason: "handshake failed" });

// RIGHT — a code the render site maps to a message
dispatch(serverId, nick, { type: "error", reason: "handshake-failed" });
```

The same rule covers any text arriving from the network: never render a
remote-supplied string as the app's own copy, especially in a security surface
like the encryption banner. Map it to a local message, and attribute the raw
text to the peer if it needs showing at all.

### Correct patterns

```tsx
// JSX children
<button>
  <Trans>Save</Trans>
</button>;

// Props with interpolation (requires useLingui inside the component)
import { useLingui } from "@lingui/react/macro";
const { t } = useLingui();
<input placeholder={t`Message #${channelName}`} />;

// Simple t tag inside render
import { t } from "@lingui/core/macro";
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

1. Run `npm run i18n:compile` to regenerate `.mjs` files.
2. Commit `src/locales/`.

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
