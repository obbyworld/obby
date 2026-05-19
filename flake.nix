{
  description = "ObsidianIRC — dev shell and Linux desktop package (Tauri + Vite)";

  # devShell + packages: x86_64-linux and aarch64-linux only (see BUILD.md / AGENTS.md).

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      # Pin HM’s nixpkgs to this flake’s input so checks and consumer overlays don’t pull two nixpkgs revisions.
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
    }:
    let
      linux = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      # Linux-only outputs share the same shape; this avoids copy-pasting `system:` boilerplate per attribute.
      forLinux =
        attrs:
        nixpkgs.lib.genAttrs linux (
          system:
          attrs (
            import nixpkgs {
              inherit system;
              config.allowUnfree = false;
            }
          )
        );
      obsidianPackageArgs = import ./nix/package-args.nix { root = ./.; };
      programsObsidianircHmModule = import ./nix/hm-module.nix;
    in
    {
      # Thin wrapper: injects `pkgs.obsidianirc` on Linux when merged into nixpkgs (see nix/overlay.nix).
      overlays.default = import ./nix/overlay.nix;

      # HM manual + flake-parts use `flake.homeModules`; keep both spellings discoverable for consumers.
      homeManagerModules.obsidianirc = programsObsidianircHmModule;
      homeModules.obsidianirc = programsObsidianircHmModule;

      devShells = forLinux (
        pkgs:
        let
          inherit (pkgs) lib mkShell;
          webkit = pkgs.webkitgtk_4_1;
          tauriLibs = with pkgs; [
            webkit
            webkit.dev
            gtk3
            gtk3.dev
            openssl
            openssl.dev
            glib-networking
            librsvg
            cairo
            libayatana-appindicator
            glib
          ];
        in
        {
          default = mkShell {
            packages = with pkgs; [
              nodejs_22
              rustup
              patchelf
              gcc
            ];
            nativeBuildInputs = with pkgs; [ pkg-config ];
            buildInputs = tauriLibs;
            env = {
              RUST_BACKTRACE = "1";
            };
            shellHook =
              let
                pkgcfg = lib.makeSearchPathOutput "dev" "lib/pkgconfig" tauriLibs;
              in
              ''
                export PKG_CONFIG_PATH="${pkgcfg}''${PKG_CONFIG_PATH:+:}$PKG_CONFIG_PATH"
                export LD_LIBRARY_PATH="${
                  lib.makeLibraryPath [
                    pkgs.glib
                    pkgs.gtk3
                    webkit
                  ]
                }''${LD_LIBRARY_PATH:+:}$LD_LIBRARY_PATH"
                echo "(ObsidianIRC) node: $(node --version) • use \`rustup show\` after first compile"
              '';
          };
        }
      );

      packages = forLinux (
        pkgs:
        let
          pkg = pkgs.callPackage ./nix/obsidianirc.nix obsidianPackageArgs;
        in
        {
          obsidianirc = pkg;
          default = pkg;
        }
      );

      # Smoke-evaluates the HM module via home-manager.lib using `hello` as a stub package so check never builds Tauri.
      checks = nixpkgs.lib.genAttrs linux (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = false;
            overlays = [ self.overlays.default ];
          };
        in
        {
          home-manager-module =
            (home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                programsObsidianircHmModule
                {
                  home = {
                    # Match HM manual examples (`home-manager` flake); only needs to evaluate for flake check.
                    stateVersion = "25.11";
                    username = "hm-oirc-check";
                    homeDirectory = "/var/empty";
                  };
                  programs.obsidianirc = {
                    enable = true;
                    package = pkgs.hello;
                  };
                }
              ];
            }).activationPackage;
        }
      );
    };
}
