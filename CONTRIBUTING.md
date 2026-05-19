# Contributing

## Clone and setup the repository

```sh
git clone https://github.com/ObsidianIRC/ObsidianIRC
cd ObsidianIRC
npm install
npm run dev  # Start the development server
```

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
We have commit hooks to enforce coding style. You can install the hoooks with:

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
