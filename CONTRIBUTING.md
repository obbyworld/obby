# Contributing

## Clone and setup the repository

```sh
git clone https://github.com/ObsidianIRC/ObsidianIRC
cd ObsidianIRC
npm install
npm run dev  # Start the development server
```

Use **`npm run …`** for scripts regardless of which toolchain you choose below.

**Optional — Nix** (Nix installs on other OSes too — [non-NixOS Linux](https://nixos.org/download/) is common): **`nix develop`** from this repo works only where the **ObsidianIRC** flake exposes a **devShell**, i.e. **`x86_64-linux`** / **`aarch64-linux`** today (**`nix build .#obsidianirc`** same). On **macOS or Windows** extend `flake.nix` or install **Node ≥22** and **Rust stable** (**rustfmt**, **clippy**) per [`rust-toolchain.toml`](rust-toolchain.toml). Desktop build via Nix: [BUILD.md — Nix (flake)](BUILD.md#nix-flake). Details: [AGENTS.md](AGENTS.md).

**Home Manager:** upstream patterns are summarized in **[Home Manager manual — Flakes](https://nix-community.github.io/home-manager/index.xhtml#ch-nix-flakes)** (e.g. **`inputs.home-manager.inputs.nixpkgs.follows`** in your flake, **`home-manager.extraSpecialArgs`**, **`useGlobalPkgs`**, **`useUserPackages`** where applicable). This repo exposes **`outputs.homeManagerModules.obsidianirc`** and **`outputs.homeModules.obsidianirc`** (same module). Detailed **`useGlobalPkgs`** overlay wiring: [BUILD.md — Nix (flake)](BUILD.md#nix-flake). If Home Manager doesn’t manage your shell, **`hm-session-vars.sh`** sourcing is unchanged from upstream — see the manual’s Installing / FAQ sections.

**Optional — [direnv](https://direnv.net/) + Nix:** install the [shell hook](https://direnv.net/docs/hook.html), then **`direnv allow`** so [.envrc](.envrc) runs **`use flake`** (nix-direnv is optional; **`.direnv/`** is gitignored).

Alternatively to run the full ObsidianIRC stack:

```sh
docker compose up
```

## Coding Style

We use [biome](https://biomejs.dev/guides/editors/first-party-extensions/) for linting and formatting.
You can run the following command to check if your code is formatted correctly:

```sh
npm run lint
npm run format
```

## Git Hooks

We use [lefthook](https://github.com/evilmartians/lefthook) for managing git hooks.
We have commit hooks to enforce coding style. You can install the hooks with:

```sh
npm run commit-hook-install
```

Now every time you commit the lint and format commands will run automatically.

## Local Development & Testing

### Development Setup

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/ObsidianIRC/ObsidianIRC
   cd ObsidianIRC
   npm install
   ```

2. **Start development server:**

   ```bash
   npm run dev
   ```

### Testing Environment

For testing features locally, we provide a complete IRC testing stack with Docker Compose (ergo IRC server + 3 bots over TLS).

#### First-time setup (once per machine)

Install [mkcert](https://github.com/FiloSottile/mkcert), then:

```bash
npm run gen-certs
```

This installs the local CA into your OS trust store and writes a `.env` file used by compose.

#### Start the stack

```bash
# in one terminal
npm run dev
# in another terminal
npm run run-dev-stack
```

To stop: `npm run stop-dev-stack`

Connect with `wss://localhost:8097` (browser/WebView) or `ircs://localhost:6697` (Tauri native TCP) and join `#test`.
