# Installing Native Obsidian IRC

Grab the latest version for your platform from [https://github.com/ObsidianIRC/ObsidianIRC/releases](https://github.com/ObsidianIRC/ObsidianIRC/releases)

## Choosing the Right Version

### Linux

- **Intel/AMD 64-bit (x86_64/amd64)**: Most desktop/laptop PCs
  - `.deb` package: `ObsidianIRC_*_amd64.deb` for Debian/Ubuntu/ZorinOS
  - `.rpm` package: `ObsidianIRC-*-1.x86_64.rpm` for Fedora/CentOS/RHEL
  - AppImage: `ObsidianIRC_*_amd64.AppImage` for any Linux distro
- **ARM 64-bit (aarch64/arm64)**: Raspberry Pi 4/5, ARM servers
  - `.deb` package: `ObsidianIRC_*_arm64.deb` for Debian/Ubuntu
  - `.rpm` package: `ObsidianIRC-*-1.aarch64.rpm` for Fedora/CentOS/RHEL
  - AppImage: `ObsidianIRC_*_aarch64.AppImage` for any Linux distro
- **NixOS / Nix-with-flakes (`x86_64-linux`, `aarch64-linux`)**: Build from source — see [BUILD.md — Nix (flake)](BUILD.md#nix-flake).

### macOS

- **Intel Macs**: `ObsidianIRC_*_x64.dmg`
- **Apple Silicon (M1/M2/M3)**: `ObsidianIRC_*_aarch64.dmg`

### Windows

- `ObsidianIRC_*_x64-setup.exe` or `ObsidianIRC_*_x64_en-US.msi`

### Mobile

- **Android**: `ObsidianIRC-*.apk` (unsigned - follow [this guide](https://developer.android.com/studio/run/install-apk))
- **iOS**: `ObsidianIRC-*-unsigned.ipa` (use [LiveContainer](https://github.com/LiveContainer/LiveContainer) or [AltStore](https://altstore.io/))

### Web

- `ObsidianIRC-*-web.zip` - Unzip and open `dist/index.html` in your browser

## Debian/Ubuntu/ZorinOS Prerequisites

Before installing the `.deb` package, you need to install the required dependencies:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0
```

If `libwebkit2gtk-4.1-0` is not available on your system, try the older version:

```sh
sudo apt install libwebkit2gtk-4.0-37 libgtk-3-0
```

**Note:** If you get "package has unmet dependencies" errors even though the packages are installed, this is a known issue with some Tauri builds. Use one of these workarounds:

1. **Force install** (not recommended but works):
  ```sh
   sudo dpkg -i --force-depends ObsidianIRC_*.deb
  ```
2. **Use the AppImage instead** (recommended - no installation needed):
  ```sh
   chmod +x ObsidianIRC-*.AppImage
   ./ObsidianIRC-*.AppImage
  ```

Standard installation after dependencies are installed:

```sh
sudo dpkg -i ObsidianIRC_*.deb
sudo apt-get install -f  # Fix any remaining dependency issues
```

Alternatively, use the **AppImage** version which includes all dependencies and doesn't require installation:

```sh
chmod +x ObsidianIRC-*.AppImage
./ObsidianIRC-*.AppImage
```

## Troubleshooting

### glibc Version Error (Debian/Ubuntu/ZorinOS)

If you get an error about glibc version or the app doesn't start, your system has an older glibc than what the build requires. This happens on older LTS releases like Ubuntu 22.04 and ZorinOS 16.

**Solution 1: Use the AppImage (Recommended)**

The AppImage bundles its own dependencies and should work on older systems:

```sh
chmod +x ObsidianIRC_*_amd64.AppImage
./ObsidianIRC_*_amd64.AppImage
```

**Solution 2: Build from Source**

Build the app on your system with your system's glibc version. See [BUILD.md](BUILD.md) for instructions.

**Solution 3: Run with Custom glibc (Not Recommended)**

If you've already installed a newer glibc manually, you can create a wrapper script:

```bash
#!/bin/bash
GLIBC_PATH="$HOME/glibc-2.39/install/lib"
SYSTEM_LIB_PATH="/usr/lib/x86_64-linux-gnu"

"$GLIBC_PATH/ld-linux-x86-64.so.2" \
  --library-path "$GLIBC_PATH:$SYSTEM_LIB_PATH" \
  /usr/bin/ObsidianIRC
```

Save as `~/bin/obsidianirc` and run `chmod +x ~/bin/obsidianirc`

**Note for Developers:** To avoid this issue in releases, build on the oldest supported Ubuntu LTS (20.04 or 22.04) to ensure maximum compatibility.

## Google Playstore

Coming soon.

## Apple App Store

Not available yet.

## Arch Linux AUR

Use the AUR helper of your choice to install ObsidianIRC. For example, using `yay`:

```sh
yay -S obsidianirc
```

## Docker

```sh
docker run -p 8080:80 mattfly/obsidian:latest
```

## Manual build and development

Compiling from source: [BUILD.md](BUILD.md). Contributor setup (optional toolchains, hooks, local test stack): [CONTRIBUTING.md](CONTRIBUTING.md).