# Example: merge into nixpkgs so consumers can use `pkgs.obsidianirc`.
#
# nixpkgs.overlays = [ inputs.obsidianirc.overlays.default ];
# final/prev: overlay convention — package set after vs before this overlay (for layering fixes without pinning forks).
_final: prev:
let
  inherit (prev) lib;
  args = import ./package-args.nix { root = ../.; };
in
# Only define the attr on Linux hosts so evaluating pkgs on Darwin doesn’t pull an unsupported desktop closure.
lib.optionalAttrs prev.stdenv.hostPlatform.isLinux {
  # callPackage fills deps from nixpkgs and merges `args` (version/src/viteBuildEnv defaults) into obsidianirc.nix.
  obsidianirc = prev.callPackage ./obsidianirc.nix args;
}
