# Retained-feature completion audit

This follows [Product scope](product-scope.md). Exclusions and deferrals remain
unchanged. A rendered control or registered endpoint is not evidence of parity.
Contracts are pinned in [Hermes integration](hermes-integration.md).

“Browser” below means isolated browsers using real self-hosted Convex and a
synthetic Hermes fixture. Live-host evidence currently covers authenticated
reads and the WebSocket handshake, including the model catalog's provider/model
shape, not prompts or configuration writes.

| Items       | Implementation                                                            | Evidence / remaining acceptance                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | App title filtering and adapter full-text search                          | Browser search; verify live profile/archive coverage.                                                                                                                                                                                        |
| 2           | Conversation rename                                                       | Control exists; add rename propagation acceptance.                                                                                                                                                                                           |
| 3–5, 36, 52 | Essentials, pins, folders, archive and inactivity rules                   | Browser archive/unarchive and mutation tests; add folder lifecycle, reordering and clock-driven archive cases. Bot organization is intentionally basic.                                                                                      |
| 6–7         | Delete and public JSON export                                             | Export unit test covers hidden reasoning across pages; browser export verifies original/branch isolation. Delete acceptance remains.                                                                                                         |
| 8–9         | Message edit/resubmit and branching by source row ID                      | Browser test confirms the earlier continuation is replaced and a branch leaves the original unchanged.                                                                                                                                       |
| 10–12       | Durable queue, edit/delete/send-next, steer/stop                          | Command claim/idempotency tests; browser regression verifies a failed control cannot release the active run's send queue. Queue editing/send-next, steering and interruption need additional scenarios.                                      |
| 13–14       | Context references and device-local last view                             | Context/composer and cached reopening tested; add explicit conversation-link and independent-navigation cases.                                                                                                                               |
| 16–19       | Upload/paste/drop and host file/folder/URL references                     | Selected file content tested; multipart uploads, pasted images and folder references need browser acceptance.                                                                                                                                |
| 20–21       | Command/skill autocomplete and dispatch                                   | Browser slash completion; verify additional catalog shapes and failures.                                                                                                                                                                     |
| 23          | Suggestions and command surfaces                                          | Partial: verify skill, connection and scheduling suggestions separately. A command catalog is not sufficient evidence.                                                                                                                       |
| 25–26       | Public message filtering, completed-work grouping, desktop tool inspector | Model/replay/browser tests exclude reasoning and collapse work; audit raw live tool details.                                                                                                                                                 |
| 29–34       | Generated-file index, native downloads, host browser, CodeMirror          | Browser editing, selected-content attachment, truncated-preview guard and file discovery; add transfer and editor-conflict cases.                                                                                                            |
| 47–50       | Profile lifecycle/instructions and canonical bot chats                    | Browser canonical chat selection; profile clone/rename/delete and instruction writes need acceptance. Check organization preservation on profile rename.                                                                                     |
| 51          | Uploaded avatar and initials fallback                                     | Browser upload/metadata test; shape choices remain limited. Generated avatars excluded.                                                                                                                                                      |
| 56–57       | Subagent progress/transcripts and delegation settings                     | Transcript filtering unit test and runtime-setting browser test; active delegated controls need a contract fixture.                                                                                                                          |
| 58–60       | Goals, loops and heartbeats                                               | Source-backed controls; cadence, conditions and pause/resume need acceptance.                                                                                                                                                                |
| 61–63       | Scheduled jobs, delivery/history and blueprints                           | Browser blueprint creation and changed-field job test; execution and delivery need live validation.                                                                                                                                          |
| 66          | Incoming webhooks                                                         | Source-backed forms; lifecycle and secret handling need acceptance.                                                                                                                                                                          |
| 67–70       | Memory settings/reset, graph and curator                                  | Browser graph edit/import/export; provider changes, reset and curator actions need acceptance. Graph snapshots use local Arura JSON.                                                                                                         |
| 71          | Installed skills inspection/edit/toggle                                   | Forms exist; persistence and toggling need acceptance. No Skills Hub.                                                                                                                                                                        |
| 73–76       | Toolsets, MCP, connectors and agent plugins                               | MCP payload and OAuth callback tests; tool provider changes, connector lifecycle and plugin management need acceptance.                                                                                                                      |
| 79          | Host computer-use readiness and settings                                  | Source audit and form; live readiness/managed restrictions unverified. No native permission UI.                                                                                                                                              |
| 83–85       | Direct secrets, approvals and clarifications                              | Browser test covers desktop/mobile approval, single/batched questions, multiple selections, partial-answer restoration, local draft preservation, secret cache exclusion and expired input. Approval-policy configuration still needs audit. |
| 86–87       | Messaging setup/user access                                               | Payload/approved-user unit tests; platform lifecycle unverified.                                                                                                                                                                             |
| 88–90       | Credentials, provider authorization, default/session models and effort    | Browser provider flow and session model selection; external provider completion needs live validation.                                                                                                                                       |
| 91          | Synced model visibility in the conversation picker                        | Two-browser hide/show test passes; live catalog shape verified with an authenticated read. Does not alter Hermes providers.                                                                                                                  |
| 92–95       | Fallbacks, auxiliaries, mixture presets and custom endpoints              | Browser fallback conflicts, auxiliary confirmation and mixture create/rename; endpoint credential preservation test. Mixture rename/delete is blocked with an existing privacy filter by an upstream preservation bug.                       |
| 102–104     | Usage, technical status, context and logs                                 | Browser context indicator; dashboard fields/log refresh need live acceptance.                                                                                                                                                                |
| 105         | Host-configured restart/update actions                                    | Handler packaged; deployment-specific wrappers not configured or exercised.                                                                                                                                                                  |
| 108–109     | Hermes backups, organization export and local diagnostics                 | Controls exist; organization export is not a consistent whole-service backup. Host backup/restore procedure unverified.                                                                                                                      |
| 110–111     | Advanced config and cached-agent resource controls                        | Runtime changed-field browser test; audit remaining advanced fields and managed restrictions.                                                                                                                                                |
| 112–114     | Own appearance controls                                                   | Independent UI; no desktop theme parity requirement.                                                                                                                                                                                         |
| 116–118     | Palette, shortcuts and silent notices                                     | Controls exist; remapping, notification read state and failure/input notices need browser acceptance.                                                                                                                                        |

## Cross-cutting acceptance

- Devices and sync: two-browser mutations, invitation reuse rejection and
  revocation pass isolated tests. Real external Hermes activity and
  suspended-phone reconnects remain to validate.
- Reconnect: intact replay ordering, gateway restart and truncated replay have
  tests. Whole snapshots replace deltas when no atomic cursor exists.
- Cache: offline history/drafts, disabled storage, stale-read guards and archive
  caching exist. Storage-pressure eviction, attachment policy and migrations
  need explicit acceptance.
- Scale: archive uses cursor pages. Main navigation and transcript queries still
  contain limits; large-workspace behavior is not certified.
- Performance: target-phone cold/repeat load and propagation have not been
  measured. Browser screenshots are not phone performance evidence.
- Deployment: Nix package and isolated packaged tests pass. The nc rollout and
  cutover have not happened.

## Acceptance order

1. Conversation mutations and blocking interactions: edit, branch, queue,
   steering, interruption, approval, clarification and direct secrets.
2. Organization/profile lifecycle, transfers and conflict recovery.
3. Automation, capability management and administrative writes.
4. Live-host validation, measured mobile behavior and parallel deployment.

Update evidence as tests are added; do not turn an untested row into an
exclusion.
