# Compile ObsidianIRC

This covers instructions for how to manually build ObsidianIRC from source for different platforms. If you are willing
to simply install it, maybe take a look at [Install instructions](INSTALL.md) first.

## Clone Repo

```sh
cd ~
git clone https://github.com/ObsidianIRC/ObsidianIRC
cd ObsidianIRC
npm install
```

### Web

```sh
npm run build
cp -R dist/* /var/www/html/
```

#### Building for a specific server

You can build the frontend by setting the following environment variables before running `npm run build`.

```sh
# Required server URL
VITE_DEFAULT_IRC_SERVER=ws://localhost:8097
# Required server name
VITE_DEFAULT_IRC_SERVER_NAME="Local"
# Optional default channels to join
VITE_DEFAULT_IRC_CHANNELS="#lobby,#bots,#test"
# Optionally hide the server list
VITE_HIDE_SERVER_LIST=true
# Optional comma-separated list of trusted media URLs
# Useful for chat bridges like Matterbridge or Matrix bridges that host media
VITE_TRUSTED_MEDIA_URLS="https://matterbridge.example.com,https://matrix-media.example.com"

# Optional OAuth2 / OIDC defaults. Only surfaced when VITE_HIDE_SERVER_LIST=true,
# i.e. single-server lock-mode. Users see a "Sign in with <label>" button
# instead of having to enter the issuer/client_id themselves. Requires the
# IRC server to support SASL IRCV3BEARER (e.g. obbyircd's oauth-provider).
VITE_DEFAULT_OAUTH_PROVIDER_LABEL="Logto"
VITE_DEFAULT_OAUTH_ISSUER="https://my-tenant.logto.app/oidc"
VITE_DEFAULT_OAUTH_CLIENT_ID="m0obbyircd1234"
# Optional, defaults to "openid"
VITE_DEFAULT_OAUTH_SCOPES="openid"
# Optional, defaults to <origin>/oauth/callback. Must be registered with the IdP.
VITE_DEFAULT_OAUTH_REDIRECT_URI="https://chat.example.com/oauth/callback"
# "jwt" (default) for Logto/Auth0/Keycloak/Google id_token.
# "opaque" for GitHub/Discord/Slack -- IRC server hits userinfo endpoint.
VITE_DEFAULT_OAUTH_TOKEN_KIND="jwt"
# Opaque only: name of the matching oauth-provider {} on the IRC server,
# so the server knows which userinfo URL to hit.
VITE_DEFAULT_OAUTH_SERVER_PROVIDER="github"
# Non-OIDC providers (GitHub) need explicit endpoints since they don't
# publish /.well-known/openid-configuration.
VITE_DEFAULT_OAUTH_AUTHORIZE_URL="https://github.com/login/oauth/authorize"
VITE_DEFAULT_OAUTH_TOKEN_URL="https://github.com/login/oauth/access_token"

# Optional: baked via vite `define` as `__BACKEND_URL__` (see vite.config.ts); available but not yet referenced in source.
VITE_BACKEND_URL=http://localhost:8080
# GIF search/embeds (`import.meta.env` in `GifSelector` / Tenor previews in `MediaPreview`)
VITE_GIPHY_API_KEY=
VITE_TENOR_API_KEY=
```

#### Provider quick-reference

**Sign in with Google**

```sh
VITE_DEFAULT_OAUTH_PROVIDER_LABEL=Google
VITE_DEFAULT_OAUTH_ISSUER=https://accounts.google.com
VITE_DEFAULT_OAUTH_CLIENT_ID=<your_client_id>.apps.googleusercontent.com
VITE_DEFAULT_OAUTH_SCOPES="openid email profile"
VITE_DEFAULT_OAUTH_TOKEN_KIND=jwt
```

obbyircd side:

```
oauth-provider "google" {
    issuer        'https://accounts.google.com';
    audience      '<your_client_id>.apps.googleusercontent.com';
    jwks-file     "/etc/obbyircd/google-jwks.json";  # curl from https://www.googleapis.com/oauth2/v3/certs
    subject-claim "sub";
};
```

**Sign in with GitHub**

```sh
VITE_DEFAULT_OAUTH_PROVIDER_LABEL=GitHub
VITE_DEFAULT_OAUTH_ISSUER=https://github.com
VITE_DEFAULT_OAUTH_CLIENT_ID=<your_client_id>
VITE_DEFAULT_OAUTH_SCOPES="read:user user:email"
VITE_DEFAULT_OAUTH_TOKEN_KIND=opaque
VITE_DEFAULT_OAUTH_SERVER_PROVIDER=github
VITE_DEFAULT_OAUTH_AUTHORIZE_URL=https://github.com/login/oauth/authorize
VITE_DEFAULT_OAUTH_TOKEN_URL=https://github.com/login/oauth/access_token
```

obbyircd side:

```
oauth-provider "github" {
    userinfo-url   'https://api.github.com/user';
    subject-claim  "login";    # or "id" for GitHub's stable user id
};
```

### Docker

```sh
docker build -t obsidianirc .
docker run -p 80:80 obsidianirc
```

#### Building Docker with custom configuration

You can pass build arguments to customize the IRC server settings. The image forwards the same **`VITE_*`** names as **`vite.config.ts`** (IRC, OAuth lock-mode, `VITE_BACKEND_URL`) plus optional **`VITE_GIPHY_API_KEY`** / **`VITE_TENOR_API_KEY`** for GIF search/embeds (`Dockerfile` lists every supported `ARG`).

```sh
docker build \
  --build-arg VITE_DEFAULT_IRC_SERVER=ws://your-server:port \
  --build-arg VITE_DEFAULT_IRC_SERVER_NAME="Your Server" \
  --build-arg VITE_DEFAULT_IRC_CHANNELS="#general,#random" \
  --build-arg VITE_HIDE_SERVER_LIST=false \
  --build-arg VITE_TRUSTED_MEDIA_URLS="https://matterbridge.example.com,https://matrix-media.example.com" \
  --build-arg VITE_DEFAULT_OAUTH_PROVIDER_LABEL="Logto" \
  --build-arg VITE_DEFAULT_OAUTH_ISSUER="https://my-tenant.logto.app/oidc" \
  --build-arg VITE_DEFAULT_OAUTH_CLIENT_ID="m0obbyircd1234" \
  --build-arg VITE_BACKEND_URL=https://api.example.net \
  --build-arg VITE_TENOR_API_KEY=your-tenor-key \
  -t obsidianirc .
```

### LINUX

#### npm / Tauri CLI

```sh
npm run tauri build -- --bundles appimage
```

For distribution packages:

```sh
# Build .deb for Debian/Ubuntu
npm run tauri build -- --bundles deb

# Build .rpm for Fedora/RHEL
npm run tauri build -- --bundles rpm

# Build AppImage (recommended - works everywhere)
npm run tauri build -- --bundles appimage
```

#### Nix (flake)

[Nix](https://nixos.org/download/) with [flakes](https://wiki.nixos.org/wiki/Flakes) enabled. Linux only (`x86_64-linux`, `aarch64-linux`).

```sh
nix develop              # Node 22 + Tauri Linux deps + rustup
nix build .#obsidianirc  # → result/bin/ObsidianIRC
```

- **direnv:** `direnv allow` activates [.envrc](.envrc) (`use flake`).
- **Home Manager:** `programs.obsidianirc` module — see [nix/hm-module.nix](nix/hm-module.nix) for options and usage.
- **Maintenance:** bump `npmDeps` in [nix/obsidianirc.nix](nix/obsidianirc.nix) when `package-lock.json` changes.
### macOS

```sh
npm run tauri build -- --bundles dmg
```

### WINDOWS

```sh
npm run tauri build -- --bundles nsis
```

### Android

```sh
npm run tauri android build -- --apk
```

### IOS

First open xcode with the tauri ws config server running:

```sh
npm run tauri ios build -- --open
```

Set the signing team in the xcode project settings and then build the app:

```sh
npm run tauri ios build
```

## Tauri

Follow the Tauri docs for more info on native builds [https://tauri.app/distribute/](https://tauri.app/distribute/)