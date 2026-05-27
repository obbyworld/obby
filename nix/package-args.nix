# One place for version/src/viteBuildEnv defaults so flake `packages` and `overlays.default` stay in lockstep (no drift).
{
  root,
  viteBuildEnv ? { },
}:
let
  pkg = builtins.fromJSON (builtins.readFile (root + "/package.json"));
  inherit (pkg) version;
  src = builtins.path {
    name = "obsidianirc-src";
    path = root;
    # Exclude files irrelevant to the build so doc/test edits don't invalidate the derivation hash.
    filter =
      path: _type:
      let
        baseName = baseNameOf path;
      in
      # Exclude .env / .env.* files (secrets/local config that must never enter the store).
      !(builtins.match "\\.env(\\..*)?" baseName != null)
      && !builtins.elem baseName [
        ".git"
        ".direnv"
        ".envrc"
        ".github"
        "node_modules"
        "result"
        "tests"
        "screenshots"
      ];
  };
in
{
  inherit version src viteBuildEnv;
}
