# 0001 — Independent SolidJS client with self-hosted Convex

**Status**: accepted direction; not implemented

**Read when** designing the replacement web client, changing its feature scope,
choosing its storage/sync architecture, or integrating it into the host deployment.

## Decision and boundaries

Build the new client in [Arura](https://github.com/u-k-g/arura): an independent SolidJS +
TypeScript web client for Hermes. The upstream
[Hermes desktop app](https://github.com/NousResearch/hermes-agent) is a behavioral
reference, filtered by the product decisions below. “Parity” means the retained
capabilities, not every desktop feature. Excluding a feature means omitting it from
this web UI, not removing or disabling it in Hermes itself.

The [existing Hermes web client](https://github.com/u-k-g/hermes-agent-desktop-web), including
its React renderer port and Deno proxy, is reference material for gateway
integration and previously solved browser problems, not the architecture to extend
with more desktop overrides. ADRs in that reference repository still describe its running app; this
decision governs the new client and does not claim the old app has migrated.

Study [Macro](https://github.com/macro-inc/macro) for SolidJS engineering, interaction,
and editor quality. Build our own UI rather than forking Macro or embedding its
workspace app. Appearance and theming are ours to design, not desktop-parity work.
Record provenance and honor licenses for any literal source reuse. Macro's sync
implementation is not a chosen dependency.

## Backend, ownership, and sync

Use **self-hosted Convex**, with TypeScript application functions. The earlier Rust
application-backend requirement has been dropped. Convex replaces the earlier Zero
proposal; do not provision Zero, zero-cache, or Postgres as assumed requirements.
Convex's documented default is its own local SQLite storage, separate from Hermes.

The user accepts Convex's FSL for this self-hosted use despite its restrictions;
do not re-exclude it solely because it is not unrestricted open source. This is
acceptance of this dependency, not permission to add arbitrary proprietary services.

Reasons for the choice and limits:

- Convex supplies reactive subscriptions and server-side mutation machinery for
  live cross-device updates without requiring Postgres. TypeScript is acceptable
  on both frontend and backend.
- Persistent browser data is additional application work. Convex's reactive cache
  is not a complete durable offline browser database. The chosen tradeoff is
  Convex plus persistent browser caching, not a promise of built-in offline sync.
- Turso Sync was considered for local storage and push/pull replication, but its
  self-hosted browser path was not validated and still requires application sync
  orchestration. LiveStore fits local-first data but a self-hosted Rust provider
  would require custom implementation and maintenance. Neither is selected.
- No comparative phone benchmark or code-quality audit established a fastest,
  lightest, or best-written engine. The choice is about implementation fit.

Hermes remains authoritative for its runtime, conversations, runs, tools, and
configuration. Keep its existing database and interfaces intact. The integration
must bring relevant Hermes activity into Convex, including activity originating
outside this web UI. Any replicated Hermes read model must be rebuildable; web-only
organization, preferences, and device/session records belong to the web application.
Convex does not automatically synchronize the existing Hermes database.

Shared durable changes and ongoing agent activity must reach all authorized,
connected browser instances promptly. Reconnect must recover missed changes without
duplicating messages or agent commands. Navigation and scroll position stay local
to each device. Do not infer that every token must be stored as a separate Convex
record; the streaming transport and persistence granularity are not yet decided.

Sources checked during selection: [Convex self-hosting](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md),
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
- Provide a setting to keep data on the device, enabled by default. Cached content
  and drafts must survive reopening. Attachment policy, eviction, migrations, and
  refresh behavior need explicit implementation; unlimited storage and literal
  instant first load are not promised. Agent execution still needs the host.
- Device access is a real Settings surface, with named browser/device sessions,
  current-device identification, activity information, and individual revocation.
  Revocation must deny subsequent requests and end authorized live access; it
  cannot remotely erase an already offline copy. Do not substitute an opaque
  shared login or a cosmetic user-agent list for revocable sessions.
- Target the existing self-hosted environment declared in [nc](https://github.com/u-k-g/nc). Inspect
  its current Hermes services and routing before deployment changes. Deploy the
  new app alongside the current one with separate state and rollback before
  cutover; this record does not change the deployment.
- The user's inference provider is OpenCode Go. No Hermes Cloud dependency or
  routine off-host storage/upload is wanted; host/device-local operation is the
  default apart from LLM inference and deliberately requested agent network work.
- Host-management actions such as restart/update must be configurable for a
  Nix-managed Hermes installation and conventional installations, rather than
  hard-coding imperative installation/update commands.

## Product scope

The recovered 126-item checklist, its dispositions, and the navigation/activity
contract live in [Product scope](../product-scope.md). That is the single source
for included, excluded, adapted, and deferred capabilities. The full original
number mapping has now been recovered; no number-only decisions remain unmapped.

Read the [Hermes integration map](../hermes-integration.md) before implementing
the adapter, data ownership, authentication, reconnect, or deployment. It separates
source-verified interfaces and limits from recommendations that need live tests.

## Foundation acceptance

Before broad feature expansion, prove one complete workflow on a phone and desktop:
authorize both and list them in Access; open an existing conversation; send on the
phone and see the reply stream on both; synchronize a rename and activity originating
outside the web app; reopen offline to cached history and drafts; reconnect without
duplicates; revoke the phone from desktop and deny its live and subsequent access.
Measure actual cold/repeat load and propagation latency on the target devices.
The earlier illustrative millisecond budgets were proposals, not measured results
or accepted hard requirements.
