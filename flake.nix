{
  description = "Arura — a self-hosted SolidJS client for Hermes";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/d482ef84049d9b7276b83a06e4e4d76983830097";
  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.deno
              pkgs.nixfmt
              pkgs.ripgrep
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.chromium ]
            ++ pkgs.lib.optionals (system == "x86_64-linux") [ self.packages.${system}.convex ];
            shellHook = ''
              export ARURA_DEV_CACHE="''${ARURA_DEV_CACHE:-$(mktemp -d /var/tmp/arura-dev.XXXXXXXX)}"
              export TMPDIR="$ARURA_DEV_CACHE/tmp"
              export DENO_DIR="$ARURA_DEV_CACHE/deno"
              export PLAYWRIGHT_BROWSERS_PATH="$ARURA_DEV_CACHE/browsers"
              mkdir -p "$TMPDIR" "$DENO_DIR" "$PLAYWRIGHT_BROWSERS_PATH"
              ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''export ARURA_BROWSER_EXECUTABLE="${pkgs.lib.getExe pkgs.chromium}"''}
            '';
          };
        }
      );
      packages.x86_64-linux =
        let
          pkgs = import nixpkgs { system = "x86_64-linux"; };
        in
        {
          default = self.packages.x86_64-linux.arura;
          arura = pkgs.callPackage ./nix/application.nix { };
          convex = pkgs.stdenv.mkDerivation {
            pname = "convex-local-backend";
            version = "2026-09-11-157eb19";
            src = pkgs.fetchurl {
              url = "https://github.com/get-convex/convex-backend/releases/download/precompiled-2026-09-11-157eb19/convex-local-backend-x86_64-unknown-linux-gnu.zip";
              hash = "sha256-xkszOfnE+pexRnQaHtVRtLKpnby+U57hBjxJBpt7ScQ=";
            };
            nativeBuildInputs = [
              pkgs.unzip
              pkgs.autoPatchelfHook
            ];
            buildInputs = [ pkgs.stdenv.cc.cc.lib ];
            dontUnpack = true;
            installPhase = ''
              mkdir -p "$out/bin"
              unzip "$src" -d "$out/bin"
              chmod +x "$out/bin/convex-local-backend"
            '';
            meta.mainProgram = "convex-local-backend";
          };
        };
      nixosModules.default = import ./nix/module.nix self;
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
