{
  lib,
  stdenvNoCC,
  deno,
  cacert,
  makeWrapper,
  writeText,
}:
let
  manifest = builtins.fromJSON (builtins.readFile ../package.json);
  lock = builtins.fromJSON (builtins.readFile ../deno.lock);
  runtimePackages = lib.filterAttrs (
    name: _:
    builtins.elem name [
      "convex"
      "dotenv"
      "jose"
      "ws"
    ]
  ) manifest.dependencies;
  runtimeManifest = writeText "arura-runtime-package.json" (
    builtins.toJSON {
      name = "arura";
      version = manifest.version;
      type = "module";
      dependencies = runtimePackages;
    }
  );
  runtimeLock = writeText "arura-runtime-deno.lock" (
    builtins.toJSON (
      lock
      // {
        specifiers = lib.filterAttrs (
          specifier: _:
          builtins.elem specifier (
            lib.mapAttrsToList (name: version: "npm:${name}@${version}") runtimePackages
          )
        ) lock.specifiers;
        workspace.packageJson.dependencies = lib.mapAttrsToList (
          name: version: "npm:${name}@${version}"
        ) runtimePackages;
      }
    )
  );
  source = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../deno.json
      ../deno.lock
      ../tsconfig.json
      ../vite.config.ts
      ../index.html
      ../src
      ../server
      ../shared
      ../convex
      ../scripts
      ../tests
      ../public
    ];
  };
  dependencies =
    production: hash:
    stdenvNoCC.mkDerivation {
      pname = "arura-${if production then "runtime" else "build"}-dependencies";
      version = "0.1.0";
      src = source;
      nativeBuildInputs = [
        deno
        cacert
      ];
      dontFixup = true;
      outputHashMode = "recursive";
      outputHashAlgo = "sha256";
      outputHash = hash;
      postPatch = lib.optionalString production ''
        cp ${runtimeManifest} package.json
        cp ${runtimeLock} deno.lock
        echo '{"nodeModulesDir":"manual"}' > deno.json
      '';
      buildPhase = ''
        export DENO_DIR="$NIX_BUILD_TOP/deno-cache"
        export DENO_NO_UPDATE_CHECK=1
        deno install --frozen ${lib.optionalString production "--prod"}
      '';
      installPhase = ''
        mkdir -p "$out"
        cp -R node_modules "$out/node_modules"
        # Installer bookkeeping can contain build-directory names and timestamps.
        rm -f "$out/node_modules/.deno/.setup-cache.bin" "$out/node_modules/.deno/.deno.lock"
      '';
    };
  buildDependencies = dependencies false "sha256-Tv9eQURM4G1htD4T9BgnHA9OJdZobZ8ytKDfXY0rmkg=";
  runtimeDependencies = dependencies true "sha256-6Vb5qkTQjXRAOA670NFN0k8prB+D6VJnjzEX9wGk+NQ=";
in
stdenvNoCC.mkDerivation {
  pname = "arura";
  version = "0.1.0";
  src = source;
  nativeBuildInputs = [
    deno
    makeWrapper
  ];
  buildPhase = ''
    export DENO_DIR="$NIX_BUILD_TOP/deno-cache"
    export DENO_NO_UPDATE_CHECK=1
    cp -R ${buildDependencies}/node_modules node_modules
    chmod -R u+w node_modules
    deno task build
  '';
  installPhase = ''
    mkdir -p "$out/share/arura" "$out/bin"
    cp -R server shared dist "$out/share/arura/"
    cp ${runtimeManifest} "$out/share/arura/package.json"
    cp ${runtimeLock} "$out/share/arura/deno.lock"
    echo '{"nodeModulesDir":"manual"}' > "$out/share/arura/deno.json"
    ln -s ${runtimeDependencies}/node_modules "$out/share/arura/node_modules"
    makeWrapper ${lib.getExe deno} "$out/bin/arura" \
      --set DENO_NO_UPDATE_CHECK 1 \
      --add-flags "run --cached-only --frozen --no-check --node-modules-dir=manual --allow-env --allow-net --allow-read --allow-write --allow-run $out/share/arura/server/index.ts"
  '';
  meta = {
    mainProgram = "arura";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
