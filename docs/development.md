# Development

The flake pins the project toolchain independently of the host configuration.
Enter it with `nix develop`, or enable `.envrc` with `direnv allow`; the envrc
contains `use flake`. It provides Deno, Nix formatting, and search tools. On
x86-64 Linux it also provides a pinned self-hosted Convex backend.

Deno installs npm-compatible dependencies from `package.json`, locks them in
`deno.lock`, and runs all project tasks, including Vite, Biome, and the Convex
CLI. Convex functions execute in Convex's own runtime. The development shell
places scratch files, Deno dependency caches, and browser downloads under a
private directory in `/var/tmp`. Nested shells reuse that directory. Set
`ARURA_DEV_CACHE` to an existing private scratch directory to reuse it across
separate shell sessions.

```sh
nix develop
deno install --frozen
deno task check
deno task format:check
deno task lint
deno task build
deno task test:integration
```

Nix checks and formatting:

```sh
nix flake check --all-systems --no-build
nix fmt flake.nix nix/module.nix nix/application.nix
nix build .#arura --no-link
```

The Convex package is currently available only on x86-64 Linux. Development
shells also support ARM Linux and Apple Silicon; those systems need a reachable
self-hosted Convex instance. No hosted Convex account is required.

`deno task test:integration` builds the UI, starts an isolated self-hosted
Convex backend and a synthetic Hermes gateway, deploys the functions, and runs
desktop and mobile Chromium tests. It uses random local ports, disposable
credentials, and a private directory in `/var/tmp`. It does not connect to the
configured Hermes deployment. Linux shells provide Chromium; another platform
can set `ARURA_BROWSER_EXECUTABLE` and `ARURA_CONVEX_EXECUTABLE` to compatible
binaries.

`deno task test` runs unit and gateway tests. Tests needing the complete stack
skip unless its environment variables are set by the integration runner. The
integration suite covers live updates, archive/restore, offline reopening,
storage-disabled browsers, device revocation, command deduplication, reasoning
filtering, ordered replay, and gateway restart recovery. This is fixture
coverage, not a claim of complete compatibility with a live Hermes installation.

Use `deno task format` to apply Biome formatting. `package.json` is the
dependency manifest used by Deno and npm-compatible tools; it does not select a
second package manager. The Convex SDK includes some CLI tooling transitively,
including Prettier; Arura itself runs only Biome for formatting and linting.

`.direnv`, dependency directories, private environment files, and runtime state
are ignored by version control. Do not include credentials in flake inputs or
Nix string literals: Nix store contents are readable by other local users.

The flake builds the application and its runtime dependencies with Deno. The
NixOS module uses that package by default. See [Deployment](deployment.md) for
private environment files, function deployment, and routing. The installed
package has passed the isolated browser suite from a fresh working directory and
Deno cache. Live NixOS deployment remains pending.

For persistent local development, run `deno task setup`, configure the private
`.env`, then run `deno task dev`. It starts a local Convex instance, deploys the
functions, and starts the adapter and Vite. The database survives restarts in
`.state/convex`. `deno task dev:external` starts only the adapter and Vite for
an existing self-hosted instance. `deno task deploy:functions` updates an
explicitly configured instance using private self-hosted administrator
credentials.

To run a selected browser acceptance case against a fresh isolated stack, build
the frontend and pass test file arguments to
`deno run -A scripts/test-stack.ts`. For example,
`deno run -A scripts/test-stack.ts tests/browser_files_test.ts`. Set
`ARURA_SERVER_EXECUTABLE` and `ARURA_DEPLOY_EXECUTABLE` to the packaged `arura`
and `arura-deploy-functions` executables to test installation and startup with
fresh caches instead of using the checkout.

`tests/hermes_runtime_test.ts` is disabled in ordinary test runs. It requires
`ARURA_ISOLATED_HERMES_HOME` under the development scratch root, the disposable
dashboard's `HERMES_URL`, and `ARURA_ISOLATED_HERMES_TOKEN_FILE`. Start that
dashboard with both `HERMES_HOME` and `HERMES_MANAGED_DIR` pointing into its
disposable state; otherwise it can inherit the machine's managed configuration.
The test verifies the reported profile home before writing, creates and removes
test resources, and uses a local inference stub. Never aim it at the production
Hermes service.
