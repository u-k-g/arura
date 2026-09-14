# Arura

This repository is the home of the new Hermes web client.

Read [ADR-0001](docs/adr/0001-independent-solid-convex-client.md) when designing or implementing the client, changing feature scope, or working on sync, storage, access, or deployment. It records the accepted SolidJS/TypeScript and self-hosted Convex direction.

Read [Product scope](docs/product-scope.md) when building or reviewing features; it maps all 126 original capability items and the agreed navigation behavior. Read [Hermes integration](docs/hermes-integration.md) when implementing the adapter, sync, authentication, or deployment; it records audited interfaces, limits, and unverified assumptions.

[The existing Hermes web client](https://github.com/u-k-g/hermes-agent-desktop-web) and [upstream Hermes](https://github.com/NousResearch/hermes-agent) are references; [nc](https://github.com/u-k-g/nc) contains the host deployment configuration. Do not treat the reference web repository as the implementation home.

## Reference repositories

- [Hermes Agent](https://github.com/NousResearch/hermes-agent): runtime, desktop behavior, gateway APIs, and event contracts; Arura implements only the retained product scope.
- [Existing Hermes web client](https://github.com/u-k-g/hermes-agent-desktop-web) and [its upstream](https://github.com/lgc2333/hermes-agent-desktop-web): browser gateway adapters, authentication, downloads, and compatibility lessons.
- [Macro](https://github.com/macro-inc/macro): SolidJS architecture, list performance, focus handling, and file-editor interaction quality; design reference, not a fork or workspace dependency.
- [T3 Code](https://github.com/pingdotgg/t3code): live-work and completed-turn presentation; the product scope defines the exact behavior.
- [Convex backend](https://github.com/get-convex/convex-backend): selected self-hosted database, reactive subscriptions, and backend deployment.
- [Convex JavaScript SDK](https://github.com/get-convex/convex-js): TypeScript functions, browser subscriptions, authentication, and host-side clients.
- [SolidJS](https://github.com/solidjs/solid) and [Solid Router](https://github.com/solidjs/solid-router): frontend reactivity and navigation.
- [Iconoir](https://github.com/iconoir-icons/iconoir): required UI icon family; use bundled icons, not a remote icon service.
- [Deno](https://github.com/denoland/deno): required runtime for Arura's host adapter and HTTP server; Convex retains its own engine/runtime.
- [Biome](https://github.com/biomejs/biome): required formatter and linter.
- [CodeMirror](https://github.com/codemirror/dev): text editing, selection, search, and language support.
- [nc](https://github.com/u-k-g/nc): declarative host packaging, services, and routing.
- [Nixpkgs](https://github.com/NixOS/nixpkgs) and [nix-direnv](https://github.com/nix-community/nix-direnv): pinned project tools, package definitions, and flake shell integration.

Previously evaluated, not selected: [Zero](https://github.com/rocicorp/mono/tree/main/packages/zero), [LiveStore](https://github.com/livestorejs/livestore), [Turso Sync](https://github.com/tursodatabase/turso), and [Electric](https://github.com/electric-sql/electric). See ADR-0001 before revisiting the sync decision.

Keep repository documentation portable: use GitHub repository links for external projects and repository-relative paths for files in this project. Do not record machine-specific absolute paths.

Use the pinned development shell with `nix develop` or direnv's `use flake`.
Use modern `nix` subcommands for builds, shells, formatting, and checks.
Use Deno for dependency installation and all project tasks, and Biome for code
formatting and linting. Do not introduce pnpm, npm scripts, or Prettier tooling.
The npm-compatible dependency manifest is `package.json`; Deno owns `deno.lock`.
See [Development](docs/development.md) for toolchain commands. Use `/var/tmp`
for temporary files, package stores, browser artifacts, and scratch work.
