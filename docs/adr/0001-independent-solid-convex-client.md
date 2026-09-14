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

## Product scope that must survive the rebuild

### Navigation

- No internal tabs, split panes, layout editor, or multitasking workspace.
- Desktop uses an Arc/Zen-inspired sidebar. **Essentials** contains only chats/bots,
  never folders. **Pinned** contains explicitly pinned items and every folder.
- Folders exist only in Pinned; their contents are considered pinned and exempt
  from automatic archiving. They organize conversations, not filesystem directories.
- Other items live below Pinned and autoarchive after seven days of inactivity,
  configurable. Do not autoarchive Essentials or pinned content.
- At the bottom, an initially collapsed Archived section shows the ten most recent
  archived items, a “Show 10 more” action, and an unarchive action on each item.
- Mobile uses bottom sheets for navigation and supporting panels in place of
  sidebars. Desktop-specific inspection controls must not leak into mobile layouts.

### Conversations, files, and agents

- Show agent work as it happens without streaming/displaying reasoning. When the
  agent finishes, keep its final response visible and collapse intermediate work
  under an expandable “Worked for __m __s” summary, inspired by
  [t3code](https://github.com/pingdotgg/t3code).
- Raw tool inspection is desktop-web only, not mobile. Message editing remains
  included; do not confuse it with coding workspace checkpoints or undoing agent
  side effects.
- Keep browsing generated files across conversations, but no image-generation UI.
  File/text editing should aim for Macro's interaction quality. Omit working-directory
  selection and coding project concepts from conversation organization.
- Use browser/device handling for PDFs and similar files; opening a PDF in a normal
  browser tab is allowed. The internal-tab exclusion is not a ban on external links.
- Profiles, bots, and delegated work should begin simple. Multi-bot group chats and
  threads within those groups are deferred, not prerequisites for the first version.
- Do not bake a skills-hub/catalog/install UI into the app. Skill installation
  should be delegated to Hermes through its own tools/skills.
- Keep in-app notifications silent. English only initially.

### Explicit exclusions and deferrals

No terminal UI or SWE workspace features, layout editor, internal tabs, embedded
browser for interacting with Hermes, HUD/native overlay mode, wake word, read-replies-
aloud, image-generation UI, or sounds. No voice dictation initially. Native
desktop-only facilities are not to be recreated just to claim parity. Live voice
is deferred. Do not reintroduce excluded capabilities through a blanket “port every
desktop feature” task.

Some earlier include/exclude instructions referred only to numbers in a capability
list whose definitions are not available in the retained conversation. This record
captures named decisions, not an invented mapping of those numbers. It is not an
exhaustive capability ledger; unresolved numbered items must be recovered from the
original list before claiming the scope is fully enumerated.

## Foundation acceptance

Before broad feature expansion, prove one complete workflow on a phone and desktop:
authorize both and list them in Access; open an existing conversation; send on the
phone and see the reply stream on both; synchronize a rename and activity originating
outside the web app; reopen offline to cached history and drafts; reconnect without
duplicates; revoke the phone from desktop and deny its live and subsequent access.
Measure actual cold/repeat load and propagation latency on the target devices.
The earlier illustrative millisecond budgets were proposals, not measured results
or accepted hard requirements.
