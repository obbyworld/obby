# Home Manager module: `programs.obsidianirc`.
#
# Consumer patterns (Home Manager manual — Nix Flakes):
# - Pin inputs: prefer `inputs.home-manager.inputs.nixpkgs.follows = "nixpkgs"` in the *consumer* flake so HM and
#   Nixpkgs stay on one revision.
# - NixOS: import `home-manager.nixosModules.home-manager`; set `home-manager.useGlobalPkgs = true`, and normally
#   `home-manager.useUserPackages = true` (recommended for `/etc/profiles`/build-vm ergonomics).
# - Pass `home-manager.extraSpecialArgs = { inherit inputs; };` when modules need flake inputs (unlocks
#   `inputs.obsidianirc.packages.${pkgs.system}.default` overrides).
#
# Overlay note: With `useGlobalPkgs`, `home-manager.users.<you>.nixpkgs.overlays` does not mutate the shared `pkgs`;
# merge ./overlay.nix into the `nixpkgs` instantiation that feeds Home Manager (`nixpkgs.overlays`, flake `nixpkgs` import, …).
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.obsidianirc;

  inherit (lib)
    all
    attrNames
    generators
    getExe
    hasAttr
    hasPrefix
    literalExpression
    mkEnableOption
    mkIf
    mkMerge
    mkOption
    types
    ;

  viteKeysOk = all (k: hasPrefix "VITE_" k) (attrNames cfg.viteBuildEnv);

  # Empty viteBuildEnv keeps the configured drv as-is; non-empty requires `.override` so VITE_* actually rebakes the frontend.
  finalPackage =
    if cfg.viteBuildEnv == { } then
      cfg.package
    else
      cfg.package.override { inherit (cfg) viteBuildEnv; };

in
{
  options.programs.obsidianirc = {
    enable = mkEnableOption "ObsidianIRC — Modern IRC Client for the web, desktop and mobile.";

    package = mkOption {
      type = types.package;
      default =
        if hasAttr "obsidianirc" pkgs then
          pkgs.obsidianirc
        else
          throw ''
            obsidianirc home-manager module: pkgs.obsidianirc missing.
            Add this flake's overlay (outputs.overlays.default) to `nixpkgs.overlays`,
            or set `programs.obsidianirc.package`, e.g. to
            inputs.obsidianirc.packages.${pkgs.stdenv.hostPlatform.system}.default.
          '';
      defaultText = literalExpression "pkgs.obsidianirc";
      description = ''
        ObsidianIRC package.
        Defaults to `pkgs.obsidianirc` after merging `outputs.overlays.default` into nixpkgs.
        Use `.override { viteBuildEnv = { ... }; }` or the `viteBuildEnv` option below to set Vite env.
      '';
    };

    viteBuildEnv = mkOption {
      default = { };
      type = types.attrsOf types.str;
      example = literalExpression ''
        {
          # Example only — add any other keys allowed by `vite.config.ts` / BUILD.md (`VITE_*` strings).
          VITE_DEFAULT_IRC_SERVER = "wss://irc.example.net";
          VITE_DEFAULT_IRC_SERVER_NAME = "Example";
          VITE_DEFAULT_IRC_CHANNELS = "#lobby";
          VITE_HIDE_SERVER_LIST = "false";
          VITE_TRUSTED_MEDIA_URLS = "https://matterbridge.example.com";
        }
      '';
      description = ''
        Bake-time overrides forwarded into `nix/obsidianirc.nix` (every key must start with `VITE_`).
        The `example` is not a full list; omit a key to keep the source default. Full names: `vite.config.ts` (`define`),
        GIF/Tenor API keys in client code (`import.meta.env`), and **BUILD.md**.
      '';
    };

    autostart = mkEnableOption "Launch ObsidianIRC when your graphical session starts (XDG autostart). Requires Home Manager's XDG integration: xdg.enable should be true (usually the default).";
  };

  # mkMerge lets autostart stay a separate fragment; assertions still gate the whole enable=true subtree.
  config = mkIf cfg.enable (mkMerge [
    {
      # Autostart writes under ~/.config (xdg); without HM XDG integration the file would land inconsistently / fail expectations.
      assertions = [
        {
          assertion = !cfg.autostart || config.xdg.enable;
          message = "programs.obsidianirc.autostart needs `xdg.enable = true` in Home Manager.";
        }
        {
          assertion = viteKeysOk;
          message = "programs.obsidianirc.viteBuildEnv: every key must start with VITE_.";
        }
        {
          assertion = cfg.viteBuildEnv == { } || (cfg.package ? override);
          message = "programs.obsidianirc.viteBuildEnv requires a package produced by ObsidianIRC’s flake/overlay (`callPackage` .override support). Replace `programs.obsidianirc.package` or simplify `viteBuildEnv`.";
        }
      ];

      home.packages = [ finalPackage ];
    }

    (mkIf cfg.autostart {
      xdg.configFile."autostart/obsidianirc.desktop".text = generators.toINI { } {
        "Desktop Entry" = {
          Type = "Application";
          Name = "ObsidianIRC";
          Comment = "Modern IRC Client for the web, desktop and mobile.";
          Exec = getExe finalPackage;
          Terminal = "false";
          Categories = "Network;InstantMessaging;";
          Keywords = "irc;chat;";
        };
      };
    })

    # Optional templates (not wired by default—the real desktop IDs live under
    # `$cfg.package/share/applications/` from Tauri—adjust after `nix-build`/`nix path-info`).
    #
    # xdg.mimeApps.defaultApplications."x-scheme-handler/irc" = "…";
    # xdg.mimeApps.defaultApplications."x-scheme-handler/ircs" = "…";
  ]);
}
