{
  lib,
  stdenv,
  rustPlatform,
  fetchNpmDeps,
  npmHooks,
  cargo-tauri,
  wrapGAppsHook4,
  pkg-config,
  openssl,
  webkitgtk_4_1,
  glib-networking,
  gtk3,
  librsvg,
  cairo,
  libayatana-appindicator,
  desktop-file-utils,
  xdg-utils,
  nodejs_22,
  version,
  src,
  viteBuildEnv ? { },
}:

let
  # `vite.config.ts` `define`: VITE_DEFAULT_IRC_* / VITE_HIDE_SERVER_LIST / VITE_TRUSTED_MEDIA_URLS / VITE_DEFAULT_OAUTH_* /
  # VITE_BACKEND_URL (optional gif/Tenor: VITE_GIPHY_API_KEY, VITE_TENOR_API_KEY). Non-VITE_ keys error below.
  # Drop empties early so unrelated keys don’t perturb the drv hash.
  viteEnvFiltered = lib.pipe viteBuildEnv [
    (lib.filterAttrs (_: v: v != null && toString v != ""))
    (
      filtered:
      lib.mapAttrs (
        name: value:
        if lib.hasPrefix "VITE_" name then
          value
        else
          throw ''
            obsidianirc: viteBuildEnv key '${name}' must start with VITE_ (see vite.config.ts and BUILD.md).
          ''
      ) filtered
    )
  ];
in

rustPlatform.buildRustPackage (
  {
    pname = "obsidianirc";
    inherit version src;

    cargoLock = {
      lockFile = ../src-tauri/Cargo.lock;
    };

    # Fetched npm tarball hash — bump when package-lock.json changes (Nix will print the expected value on mismatch).
    npmDeps = fetchNpmDeps {
      name = "obsidianirc-npm-deps-${version}";
      inherit src;
      hash = "sha256-JBagIH3/F891OQkYTpQGcImtUbSV24CMW1nh5MZF0QU=";
    };

    nativeBuildInputs = [
      # Runs the Vite/npm frontend build inside the Rust drv instead of a separate manual step.
      cargo-tauri.hook
      nodejs_22
      npmHooks.npmConfigHook
      pkg-config
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapGAppsHook4 ];

    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
      gtk3
      glib-networking
      openssl
      webkitgtk_4_1
      librsvg
      cairo
      libayatana-appindicator
    ];

    cargoRoot = "src-tauri";
    buildAndTestSubdir = "src-tauri";

    # tauri-plugin-deep-link register_all() shells out to update-desktop-database and xdg-mime at runtime.
    preFixup = ''
      gappsWrapperArgs+=(--prefix PATH : "${
        lib.makeBinPath [
          desktop-file-utils
          xdg-utils
        ]
      }")
    '';

    # Tauri tests require a display server and dbus session; skip in sandbox.
    doCheck = false;

    meta = {
      description = "Modern IRC Client for the web, desktop and mobile.";
      homepage = "https://github.com/ObsidianIRC/ObsidianIRC";
      license = lib.licenses.gpl3Only;
      mainProgram = "ObsidianIRC";
      platforms = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      maintainers = [ ];
    };
  }
  # Extra top-level attrs become drv env for the hooks/phases that invoke npm/vite (see `viteBuildEnv` / HM module).
  // viteEnvFiltered
)
