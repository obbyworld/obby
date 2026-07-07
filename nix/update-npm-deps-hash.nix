# Recomputes fetchNpmDeps hash from package-lock.json and patches nix/obsidianirc.nix.
# Run: nix run .#update-npm-deps-hash
{ pkgs }:

pkgs.writeShellApplication {
  name = "update-npm-deps-hash";
  runtimeInputs = with pkgs; [
    prefetch-npm-deps
    gnused
  ];
  text = ''
    set -euo pipefail
    hash=$(prefetch-npm-deps package-lock.json)
    echo "updated npmDeps hash: $hash" >&2
    sed -i "s|hash = \"sha256-[^\"]*\";|hash = \"$hash\";|" nix/obsidianirc.nix
  '';
}
