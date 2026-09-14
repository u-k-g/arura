# Retained-feature completion audit

This follows [Product scope](product-scope.md). Exclusions and deferrals remain
unchanged. A rendered control or registered endpoint is not evidence of parity.
Contracts are pinned in [Hermes integration](hermes-integration.md).

“Browser” below means isolated browsers using real self-hosted Convex and a
synthetic Hermes fixture. Production-host evidence covers authenticated reads and the WebSocket handshake.
A separate disposable installation of the pinned Hermes runtime covers local
writes, backups, and real gateway execution through a local inference stub.
It does not use production credentials or change Manara's running agent.

| Items       | Implementation                                                            | Evidence / remaining acceptance                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | App title filtering and adapter full-text search                          | Browser search and source-backed profile/archive search. Production search coverage is a rollout check.                                                                                                                                                                                        |
| 2           | Conversation rename                                                       | Two-browser rename propagation and independent active views pass.                                                                                                                                                                                           |
| 3–5, 36, 52 | Essentials, pins, folders, archive and inactivity rules                   | Two-device folder creation/rename/reorder/removal, archive/restore, inactivity boundaries, and a paginated sweep beyond 1,000 recent entries pass. Bot organization is intentionally basic.                                                                                      |
| 6–7         | Delete and public JSON export                                             | Public export filtering, original/branch isolation, and cross-device deletion pass.                                                                                                         |
| 8–9         | Message edit/resubmit and branching by source row ID                      | Browser test confirms the earlier continuation is replaced and a branch leaves the original unchanged.                                                                                                                                       |
| 10–12       | Durable queue, edit/delete/send-next, steer/stop                          | Browser acceptance covers queue editing/removal/priority, more than 100 blocked sends without starving controls, rejected/accepted steering, stopping and subsequent queued work. Claim/idempotency and failed-control isolation pass.                                      |
| 13–14       | Context references and device-local last view                             | Conversation and folder references, independent navigation, and cached reopening pass.                                                                                                                               |
| 16–19       | Upload/paste/drop and host file/folder/URL references                     | Browser selected-content attachment, multipart file transfer, pasted-image transfer, and host-folder references are covered.                                                                                                                                |
| 20–21       | Command/skill autocomplete and dispatch                                   | Browser slash completion and skill suggestions use the pinned catalog shapes; optional completion failures leave the composer usable.                                                                                                                                                                     |
| 23          | Suggestions and command surfaces                                          | Skill insertion and a prefilled editable schedule pass browser acceptance. Connection-repair suggestions route to the existing connector controls without starting authorization automatically.                                                                                                                       |
| 25–26       | Public message filtering, completed-work grouping, desktop tool inspector | Model, replay, browser, and disposable-runtime checks exclude reasoning. Raw tool inspection is desktop-only, including when a touch device is in landscape.                                                                                                                                                 |
| 29–34       | Generated-file index, native downloads, host browser, CodeMirror          | Browser editing, selected-content attachment, truncated-preview guard, file discovery, upload/download and two-device conflicts pass. Adapter serializes same-path writes and compares the expected content; external Hermes/file writers lack an atomic CAS.                                                                                                            |
| 47–50       | Profile lifecycle/instructions and canonical bot chats                    | Browser clone/instructions/rename/rename-back/delete pass, preserving folders and open-chat drafts. Explicit aliases avoid conflating cloned source IDs. A durable rename intent recovers an injected lost source acknowledgment; the pending intent is cleared after migration.                                                                                     |
| 51          | Uploaded avatar and initials fallback                                     | Browser upload/metadata test; shape choices remain limited. Generated avatars excluded.                                                                                                                                                      |
| 56–57       | Subagent progress/transcripts and delegation settings                     | Browser delegated-progress/stop controls and runtime settings pass against a source-backed fixture; transcript checks exclude reasoning and raw tool arguments.                                                                                                                          |
| 58–60       | Goals, loops and heartbeats                                               | Browser and disposable-runtime checks cover creation, multiline goal verification, cadence, pause/resume and clearing/stopping. Wait barriers and conditions follow the pinned control contract.                                                                                                                                                                |
| 61–63       | Scheduled jobs, delivery/history and blueprints                           | Browser blueprint creation, contextual schedule creation, pause/resume/run/delete and changed-field preservation pass. Actual execution and delivery are deployment acceptance.                                                                                                                                          |
| 66          | Incoming webhooks                                                         | Real Hermes create/disable/delete passes. Browser checks cover one-time secret display, omission from shared listings/device caches, toggling, and deletion.                                                                                                                                                                          |
| 67–70       | Memory settings/reset, graph and curator                                  | Browser graph edit/import/export plus real Hermes memory inspection/reset and curator pause/resume pass. Provider configuration and curator-run actions follow the pinned host interfaces. Graph snapshots use local Arura JSON.                                                                                                         |
| 71          | Installed skills inspection/edit/toggle                                   | Real Hermes installed-skill reading, editing and toggling persist. The UI uses those audited fields; no Skills Hub.                                                                                                                                                                        |
| 73–76       | Toolsets, MCP, connectors and agent plugins                               | Real MCP create/toggle/delete and toolset toggles pass; browser MCP/provider flows and payload checks pass. Connector and agent-plugin controls use audited RPCs; authorization links open normally. External-provider completion is a rollout check.                                                                                                                      |
| 79          | Host computer-use readiness and settings                                  | Source-backed readiness and host configuration controls. Availability and host-managed restrictions depend on deployment; no native permission UI.                                                                                                                                              |
| 83–85       | Direct secrets, approvals and clarifications                              | Browser test covers desktop/mobile approval, single/batched questions, multiple selections, partial-answer restoration, local draft preservation, secret cache exclusion and expired input. Advanced settings preserve the pinned approvals configuration; local config writes and changed-field preservation pass. |
| 86–87       | Messaging setup/user access                                               | Source-backed platform configuration and approved-user payload tests. Real messaging delivery and provider credentials are deployment-specific checks.                                                                                                                                                                             |
| 88–90       | Credentials, provider authorization, default/session models and effort    | Browser provider flow and session model selection pass; actual OpenCode Go inference through production routing is a rollout check.                                                                                                                                       |
| 91          | Synced model visibility in the conversation picker                        | Two-browser hide/show test passes; live catalog shape verified with an authenticated read. Does not alter Hermes providers.                                                                                                                  |
| 92–95       | Fallbacks, auxiliaries, mixture presets and custom endpoints              | Browser fallback conflicts, auxiliary confirmation and mixture create/rename; endpoint credential preservation test. Mixture rename/delete is blocked with an existing privacy filter by an upstream preservation bug.                       |
| 102–104     | Usage, technical status, context and logs                                 | Browser context indicators and authenticated status/health/usage reads are covered. Host resource availability and real logs are rollout checks.                                                                                                                                                                |
| 105         | Host-configured restart/update actions                                    | Host action handler is packaged. The nc declaration supplies the deployment-specific executable wrappers and permissions.                                                                                                                                                                  |
| 108–109     | Hermes backups, organization export and local diagnostics                 | Real Hermes ZIP creation/download and shared browser backup progress pass. Workspace export covers organization; whole-service state and restore requirements are documented for the host backup declaration. No support uploads.                                                                                                                      |
| 110–111     | Advanced config and cached-agent resource controls                        | Runtime changed-field browser checks and real config writes pass. Advanced saves send only changed leaves and reject same-field conflicts; host-managed restrictions remain a rollout check.                                                                                                                                                |
| 112–114     | Own appearance controls                                                   | Independent UI; no desktop theme parity requirement.                                                                                                                                                                                         |
| 116–118     | Palette, shortcuts and silent notices                                     | Two-device shortcut remapping, notification read-state propagation and navigation pass; input/completion/failure notices use the tested run and interaction event contracts.                                                                                                                                        |

## Cross-cutting acceptance

- Devices and sync: two-browser mutations, invitation reuse rejection, revocation,
  shared backup progress, and profile-rename recovery pass. Production routing
  and suspended-phone reconnects are rollout checks.
- Reconnect: ordered replay, gateway restart and truncated replay have tests.
  Whole snapshots replace deltas when Hermes has no atomic cursor. Changes from
  interfaces without events are reconciled periodically.
- Cache: offline history/drafts, disabled storage, stale-read guards, archive
  caching, storage-pressure eviction and database migration pass. App assets and
  viewed conversation data are cached; binary attachments remain host downloads.
  Browser storage eviction is recoverable, but cannot be prevented by a website.
- Scale: recent navigation and archive use cursor pages; a 1,005-conversation
  test covers entries beyond the former navigation cutoff. History no longer
  stops at 50 pages. This is not certification for arbitrarily large workspaces
  beyond browser or Convex resource limits.
- Mobile: portrait and landscape use sheets on touch devices. Desktop-only raw
  tool inspection stays hidden and Enter inserts a newline in the mobile composer.
  Target-phone timing and background suspension require the deployed origin.
- Packaging: the application and packaged function deployer run against fresh
  caches and a real self-hosted Convex backend. The NixOS module supplies ordered
  startup, persistent state and private environment files. It leaves existing
  Hermes ownership with the host declaration.

## Remaining boundary

Handoff verification: the full isolated suite passes **29 tests**, with the
opt-in real-runtime test skipped there and run separately through **nine passing
steps**. The Nix package builds, the module evaluates, and packaged function
deployment succeeds with network access restricted to the selected Convex
endpoint. Biome formatting and lint checks pass; lint still reports advisory
warnings, primarily the flexible types used for upstream resource payloads.

The next implementation site is [nc](https://github.com/u-k-g/nc), using the
[deployment handoff](deployment.md#handoff-to-nc). No production Hermes writes,
nc edits, public routing changes or cutover are part of this repository's test
runs. Real provider authorization, messaging delivery, maintenance permissions,
whole-host backup restoration and phone performance are deployment acceptance,
not claims made by the isolated suite.

Known upstream constraints remain explicit: file editing cannot atomically
compare-and-swap against writers outside Arura, and Mixture of Agents
rename/delete is blocked when the pinned upstream's privacy-filter preservation
bug applies. Omitting those checks would risk overwriting existing host state.
Voice and elaborate multi-bot workflows remain the agreed deferrals; excluded
features remain excluded.
