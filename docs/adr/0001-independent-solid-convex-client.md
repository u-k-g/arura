# 0001 — Independent SolidJS client with self-hosted Convex

**Status**: accepted; implementation in progress

**Read when** designing Arura, changing its feature scope, choosing its
storage/sync architecture, or integrating it into the host deployment.

## Decision and boundaries

Build the new client in [Arura](https://github.com/u-k-g/arura): an independent
SolidJS + TypeScript web client for Hermes. The upstream
[Hermes desktop app](https://github.com/NousResearch/hermes-agent) is a
behavioral reference, filtered by the product decisions below. “Parity” means
the retained capabilities, not every desktop feature. Excluding a feature means
omitting it from this web UI, not removing or disabling it in Hermes itself.

Use Hermes desktop as the visual and interaction reference, matching placement
and sizing for the retained scope with Iconoir equivalents. Preserve the agreed
mobile bottom sheets and exclusions. Keep Macro's light/dark color scheme as the
default alongside standalone theme presets described in the product scope.
[Macro](https://github.com/macro-inc/macro) remains a SolidJS engineering and
file-editor reference, not the shell design. Record provenance and honor
licenses for literal source reuse.

## Backend, ownership, and sync

Use **self-hosted Convex**, with TypeScript application functions. The earlier
Rust application-backend requirement has been dropped. Convex replaces the
earlier Zero proposal; do not provision Zero, zero-cache, or Postgres as assumed
requirements. Convex's documented default is its own local SQLite storage,
separate from Hermes.

Run Arura's host adapter and HTTP server on **Deno**, as explicitly selected
during implementation. Convex runs its own backend engine and function
environment; Deno manages dependencies, project tasks, frontend tooling, and the
application host runtime. Convex retains its own function runtime. Use Biome for
formatting and linting; do not reintroduce pnpm or Prettier.

The user accepts Convex's FSL for this self-hosted use despite its restrictions;
do not re-exclude it solely because it is not unrestricted open source. This is
acceptance of this dependency, not permission to add arbitrary proprietary
services.

Reasons for the choice and limits:

- Convex supplies reactive subscriptions and server-side mutation machinery for
  live cross-device updates without requiring Postgres. TypeScript is acceptable
  on both frontend and backend.
- Persistent browser data is additional application work. Convex's reactive
  cache is not a complete durable offline browser database. The chosen tradeoff
  is Convex plus persistent browser caching, not a promise of built-in offline
  sync.
- Turso Sync was considered for local storage and push/pull replication, but its
  self-hosted browser path was not validated and still requires application sync
  orchestration. LiveStore fits local-first data but a self-hosted Rust provider
  would require custom implementation and maintenance. Neither is selected.
- No comparative phone benchmark or code-quality audit established a fastest,
  lightest, or best-written engine. The choice is about implementation fit.

Hermes remains authoritative for its runtime, conversations, runs, tools, and
configuration. Keep its existing database and interfaces intact. The integration
must bring relevant Hermes activity into Convex, including activity originating
outside this web UI. Any replicated Hermes read model must be rebuildable; only
organization and preferences unsupported by Hermes, plus browser access records,
belong to the web application. Convex does not automatically synchronize the
existing Hermes database.

Shared durable changes and ongoing agent activity must reach all authorized,
connected browser instances promptly. Reconnect must recover missed changes
without duplicating messages or agent commands. Navigation and scroll position
stay local to each device. Do not infer that every token must be stored as a
separate Convex record; the streaming transport and persistence granularity are
not yet decided.

Sources checked during selection:
[Convex self-hosting](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md),
[sync behavior and offline limits](https://www.convex.dev/sync),
[backend license](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md),
[Turso browser sync example](https://github.com/tursodatabase/turso/tree/main/examples/javascript/sync-wasm-vite),
[LiveStore custom providers](https://docs.livestore.dev/sync-providers/custom/).
These are version-sensitive references, not compatibility guarantees.

## Browser storage, hosting, and device access

- Mobile web is first class while desktop remains fully usable. Optimize repeat
  visits to show locally saved content immediately and reconcile fresh data in
  the background. Cache versioned app assets, conversation data, metadata, and
  drafts where practical; avoid downloading complete histories unnecessarily.
- Provide a setting to keep data on the device, enabled by default. Cached
  content and drafts must survive reopening. Attachment policy, eviction,
  migrations, and refresh behavior need explicit implementation; unlimited
  storage and literal instant first load are not promised. Agent execution still
  needs the host.
- Device access is a real Settings surface, with named browser/device sessions,
  current-device identification, activity information, and individual
  revocation. Revocation must deny subsequent requests and end authorized live
  access; it cannot remotely erase an already offline copy. Do not substitute an
  opaque shared login or a cosmetic user-agent list for revocable sessions.
- Target the existing self-hosted environment declared in
  [nc](https://github.com/u-k-g/nc). Inspect its current Hermes services and
  routing before deployment changes. Deploy the new app alongside the current
  one with separate state and rollback before cutover; this record does not
  change the deployment.
- The user's inference provider is OpenCode Go. No Hermes Cloud dependency or
  routine off-host storage/upload is wanted; host/device-local operation is the
  default apart from LLM inference and deliberately requested agent network
  work.
- Host-management actions such as restart/update must be configurable for a
  Nix-managed Hermes installation and conventional installations, rather than
  hard-coding imperative installation/update commands.

## Product scope

The recovered 126-item checklist, its dispositions, and the navigation/activity
contract live in [Product scope](../product-scope.md). That is the single source
for included, excluded, adapted, and deferred capabilities. The full original
number mapping has now been recovered; no number-only decisions remain unmapped.

## Foundation acceptance

Before broad feature expansion, prove one complete workflow on a phone and
desktop: authorize both and list them in Access; open an existing conversation;
send on the phone and see the reply stream on both; synchronize a rename and
activity originating outside the web app; reopen offline to cached history and
drafts; reconnect without duplicates; revoke the phone from desktop and deny its
live and subsequent access. Measure actual cold/repeat load and propagation
latency on the target devices. The earlier illustrative millisecond budgets were
proposals, not measured results or accepted hard requirements.
