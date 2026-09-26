# Product scope

Read when building a screen, defining a capability, or reviewing feature
coverage. This is the named scope for the independent client chosen in
[ADR-0001](adr/0001-independent-solid-convex-client.md). The numbers below
identify the recovered 126-item desktop checklist; they are traceability
references, not new feature priorities. Unexcluded items remain in scope under
the user's original parity request. Retained does not mean implemented or
required in the first slice. Hermes itself stays unchanged.

The original list referenced desktop
[controls](https://github.com/NousResearch/hermes-agent/blob/a7254e2d4c170725a4136591e96efc5066251d2c/apps/desktop/src/i18n/en.ts),
[settings](https://github.com/NousResearch/hermes-agent/blob/a7254e2d4c170725a4136591e96efc5066251d2c/apps/desktop/src/app/settings/constants.ts),
and
[bots](https://github.com/NousResearch/hermes-agent/blob/a7254e2d4c170725a4136591e96efc5066251d2c/apps/desktop/src/plugins/hermes-bots/i18n.ts).

## Capability ledger

| Original items | Capability                                                                                                     | Disposition                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1              | Conversation search and filtering                                                                              | Retain.                                                                                                                                                                            |
| 2              | Rename conversations                                                                                           | Retain.                                                                                                                                                                            |
| 3–5            | Pin, archive/restore, automatic archiving                                                                      | Adapt to the navigation contract below.                                                                                                                                            |
| 6–7            | Delete and export conversations                                                                                | Retain. Deletion is distinct from archiving.                                                                                                                                       |
| 8              | Edit and resubmit an earlier message                                                                           | Retain. Does not undo filesystem or external side effects.                                                                                                                         |
| 9              | Branch from a message into a new conversation                                                                  | Retain.                                                                                                                                                                            |
| 10             | Queue follow-ups; edit/delete/send-next                                                                        | Retain.                                                                                                                                                                            |
| 11–12          | Steer and stop active runs                                                                                     | Retain.                                                                                                                                                                            |
| 13–14          | Link conversations as context; reopen last conversation                                                        | Retain. Reopening/navigation is device-local.                                                                                                                                      |
| 15             | Import Claude Code/Codex conversations                                                                         | Exclude.                                                                                                                                                                           |
| 16–18          | File/image attachments, paste/drop, folder and host-file references                                            | Retain. Image input is not image generation.                                                                                                                                       |
| 19             | URL attachments for agent context                                                                              | Retain. Not a website embed.                                                                                                                                                       |
| 20–21          | Slash commands, skill mentions, autocomplete                                                                   | Retain.                                                                                                                                                                            |
| 22             | Prompt snippets                                                                                                | Exclude.                                                                                                                                                                           |
| 23             | Contextual skill, connection, and scheduling suggestions                                                       | Retain for supported workflows; no cloud upsells or excluded workflows.                                                                                                            |
| 24             | Emoji reactions                                                                                                | Exclude.                                                                                                                                                                           |
| 25             | Reasoning blocks / work presentation                                                                           | Replace with readable activity and final-answer presentation below. Never display or stream reasoning to the UI.                                                                   |
| 26             | Detailed tool inputs/outputs                                                                                   | Desktop web only; mobile retains readable activity and required interactions.                                                                                                      |
| 27             | Inline website/media embeds                                                                                    | Exclude. Use ordinary links.                                                                                                                                                       |
| 28             | Live voice conversations                                                                                       | Deferred.                                                                                                                                                                          |
| 29             | Cross-conversation artifact library                                                                            | Retain generated-file browsing; no image-generation UI.                                                                                                                            |
| 30–31          | File previews and saving/downloading                                                                           | Use browser/device handling, including normal PDF viewing in a browser tab.                                                                                                        |
| 32             | Host directory browsing                                                                                        | Exclude intentionally. No host directory browser; retain conversation artifacts and downloads.                                                                                     |
| 33–34          | Text-file viewer/editor; attach selected content/lines                                                         | Exclude general host-file editing and attaching selections. Retain dedicated profile/configuration editors.                                                                        |
| 35             | File checkpoints and rollback/rerun                                                                            | Exclude checkpoint UI. Message editing remains independent.                                                                                                                        |
| 36             | Directory-based projects                                                                                       | Replace with logical conversation folders, unrelated to filesystem directories.                                                                                                    |
| 37–38          | Working directories and Git discovery                                                                          | Exclude.                                                                                                                                                                           |
| 39–44          | Branches/worktrees, diffs, staging/reverting, commits/pushes, PRs, coding review/shortcuts                     | Exclude.                                                                                                                                                                           |
| 45–46          | Development previews and execution-environment configuration                                                   | Exclude. Does not remove runtime tools from Hermes or exclude inference API-key settings.                                                                                          |
| 47–50          | Profiles, lifecycle, personality/instructions, bot roster/chats                                                | Retain a simple initial selection, creation, and configuration experience.                                                                                                         |
| 51             | Bot avatars                                                                                                    | Retain basic choices/uploads; generated avatars are excluded by the global no-image-generation rule.                                                                               |
| 52             | Organize/hide/pin/filter bots                                                                                  | Adapt to the same simple navigation; elaborate management is later work.                                                                                                           |
| 53–55          | Multi-bot groups, group threads, participation controls                                                        | Deferred.                                                                                                                                                                          |
| 56–57          | Subagent progress/transcripts and configuration                                                                | Retain, initially simple; filter reasoning from transcript display too.                                                                                                            |
| 58–60          | Goals, repeated-prompt loops, heartbeats                                                                       | Retain controls, progress, cadence, conditions, and pause/resume as applicable.                                                                                                    |
| 61–63          | Scheduled jobs, model/delivery/run details, automation blueprints                                              | Retain.                                                                                                                                                                            |
| 64–65          | Kanban boards and Kanban orchestration                                                                         | Exclude.                                                                                                                                                                           |
| 66             | Incoming webhook management                                                                                    | Retain. An intentional external trigger, not hosted sync.                                                                                                                          |
| 67–70          | Memory settings/data/reset, Memory Graph, skill curator                                                        | Retain. Host-local; runtime configuration may disable these features.                                                                                                              |
| 71             | Installed-skills browsing/inspection/management                                                                | Retain.                                                                                                                                                                            |
| 72             | Skills Hub discovery/install catalog                                                                           | Exclude UI. Ask Hermes to manage/install skills through its own capabilities.                                                                                                      |
| 73–76          | Toolsets, MCP servers, app connectors, agent plugins                                                           | Retain supported local management; outbound connections only for intentionally configured services.                                                                                |
| 77             | Desktop UI plugins                                                                                             | Exclude. Agent plugins are distinct from UI extensions.                                                                                                                            |
| 78             | In-app browser                                                                                                 | Exclude.                                                                                                                                                                           |
| 79             | Computer-use configuration/controls                                                                            | Retain applicable host-runtime controls, not native desktop OS permission UI.                                                                                                      |
| 80–82          | Browser-profile login reuse, password vault, password-manager integration                                      | Exclude.                                                                                                                                                                           |
| 83             | Task-time credential/code requests                                                                             | Retain direct secret/code input as needed; no vault/unlock management UI. Never store secrets in content caches.                                                                   |
| 84–85          | Action approvals/policies and clarification questions                                                          | Retain, including on mobile.                                                                                                                                                       |
| 86–87          | Messaging setup and messaging-user access                                                                      | Retain. Messaging-user access is separate from Arura device access.                                                                                                                |
| 88–91          | Provider credentials, default/per-conversation models, reasoning effort, model-picker choices                  | Retain. Reasoning effort configuration is not permission to show reasoning text.                                                                                                   |
| 92–95          | Fallback/auxiliary models, Mixture of Agents, custom inference endpoints                                       | Retain. Respect the user's configured inference provider; no Hermes Cloud prerequisite.                                                                                            |
| 96–101         | Local-model installs, multiple gateways, per-profile remote routing, SSH, Hermes Cloud, Nous billing           | Exclude. One configured Hermes host.                                                                                                                                               |
| 102–104        | Usage, technical indicators, health/status/logs                                                                | Retain. Provider cost estimates may not equal an OpenCode Go subscription bill.                                                                                                    |
| 105            | Restart/update Hermes                                                                                          | Retain separate host-configured actions suitable for Nix or conventional installs. UI invokes predefined actions, not arbitrary shell commands.                                    |
| 106–107        | Install/repair/uninstall and diagnostic health/security-audit actions                                          | Exclude. Status/log reading remains included.                                                                                                                                      |
| 108–109        | Backups and diagnostic reports                                                                                 | Retain host creation and local download. No upstream support uploads. Include web-owned state in backup coverage.                                                                  |
| 110–111        | Advanced runtime settings, warm backends/idle timeouts                                                         | Retain in Settings. Preserve managed-setting boundaries.                                                                                                                           |
| 112–114        | Appearance, themes, detailed visual controls                                                                   | Match Hermes desktop styling for retained UI; no theme-marketplace commitment.                                                                                                     |
| 115            | Language selection                                                                                             | Exclude initially; English only.                                                                                                                                                   |
| 116–117        | Command palette and customizable shortcuts                                                                     | Keep click/touch search and actions. Command+K opens the palette and composer Command+Enter follows the behavior below; other app shortcuts and shortcut settings remain disabled. |
| 118            | Notifications                                                                                                  | Exclude the notification center, bell/badge, settings, and stored event notifications. Keep feedback for user actions and required prompts in context.                             |
| 119–126        | Sounds, tours/splash, decorative effects, pets, radio, Quick Entry, popouts/floating composer, native settings | Exclude.                                                                                                                                                                           |

Also excluded before the numbered list: terminal UI, internal tabs, split panes,
layout editor, HUD mode, wake word, dictation initially, and reading replies
aloud. The image-generation exclusion covers buttons, model setup, workflows,
and avatars; it does not prohibit attaching, opening, or downloading existing
images.

## Navigation and activity contract

Hermes desktop is the visual/interaction reference for retained features,
including placement and sizing, with Iconoir equivalents. Macro remains the
default theme; Grove, Jade, Black Rose, Gruvbox Dark Hard, and Rosé Pine are
bundled alternatives, selected per browser independently of nc. Hermes owns
supported state; Convex caches it for the UI. Pin/archive changes work across
Hermes surfaces. Essentials, folders and Arura ordering are web-only data.

New conversation opens an unsaved blank composer. Opening it, choosing a model,
or leaving it must not create a saved thread; create one on the first send. The
last model selected in the composer is shared across threads and devices.
Opening a thread does not restore its previous model choice; the next submitted
message uses the current selection. Hermes still owns each run's model metadata.

Organization writes use the same profile-scoped session PATCH API as desktop.
Convex keeps pending writes until the host acknowledges their revision; an older
snapshot cannot undo a pending action. Source changes arrive on session events
or a five-second fallback poll. Essentials and folder members appear pinned in
the old UI. An explicit upstream unpin/archive removes Arura saved placement;
unchanged upstream pins preserve it. No history databases are copied or
replaced. Automatic-archive enablement and days come from Hermes's session
configuration; the settings page writes that configuration. Arura's sweep
consumes its cached copy while protecting active work and its own unarchive
grace period.

- Use Lexical for the chat composer, with selectable skill/command and context
  references. Keep drafts and Hermes messages as plain text. CodeMirror remains
  the editor for configuration and profile instructions. General host-file
  browsing and editing are intentionally excluded; a visual rich-text document
  editor is not required.
- **Essentials:** icon-only, manually chosen chats/bots, with names available as
  tooltips and accessible labels. Tiles flex and wrap to fill the available
  width. They keep a muted fill, darken slightly on hover, and use a border for
  the selected entry. Context-menu icon choices sync across devices. No folders.
  Never autoarchive.
- The sidebar footer's thread actions include Archive (Unarchive for archived
  chats) for the open conversation, without a pin button.
- Essentials and Pinned are context-menu toggles. Toggling the current section
  off returns the item to the ordinary list; either toggle clears folder
  membership. There is no separate "Move to conversations" action.
- Queued messages appear in a compact collapsible panel above the composer, with
  Clear All and per-message edit/delete/Send Now controls. Send Now steers
  active work, or submits normally if idle; there is no standalone Steer button.
  Enter inserts a newline. Command+Enter submits nonempty composer text (queue
  while running); with empty text it sends the first queued message now.
  Command+K opens the command palette. Other application shortcuts remain
  disabled.
- In the command palette, entering a single digit 1–9 selects that sidebar
  conversation slot. Slots follow the visible order: Essentials, standalone
  Pinned chats, folder contents, then unpinned conversations. Folder headers and
  drafts do not consume slots; archived conversations are excluded.
- Sidebar navigation has one horizontal icon-only row: Threads, Bots, and Cron
  jobs. Bots and Cron jobs replace the sidebar's conversation list with their
  own item lists; the main pane shows the selected item's details without a
  second list. Artifacts lives at the bottom of the sidebar beside Settings,
  replacing Files on host. Threads returns to the last conversation. Mobile uses
  the same row in its navigation sheet and closes the sheet on selection.
- Messaging setup lives in Settings, with no permanent sidebar shortcut.
- Use the global search palette; no separate sidebar session-search field.
- Scheduled jobs show all profiles together, with blueprints in the job list,
  compact timestamps and prompt previews, and primary actions above the details.
  The newest run conversation for each job appears in Threads. A newer run
  replaces the older run there without deleting its Hermes history. The visible
  run can be archived manually and stays in Archived; scheduled run
  conversations do not autoarchive.
- Settings has one gear button in the sidebar footer, not the top bar. The
  default profile setting chooses the profile for new chats. Archive is
  available in both the top bar and each chat's context menu. Archiving or
  deleting the open chat returns to a blank new-chat screen in the default
  profile.
- Bot conversations display their bot's name rather than "Bot Chat". Preserve
  Hermes's canonical session title internally so bot discovery remains
  compatible. Bot conversations cannot be archived. Each bot can be shown or
  hidden in Threads from Profiles & bots. Its sidebar action opens that bot's
  settings while the age label remains visible.
- The model picker opens as a compact popover anchored to its composer button,
  with a left rail containing only providers and Starred (no All models),
  opening on Starred, with a searchable model list, per-model stars synchronized
  across devices, and an always-visible reasoning effort selector limited to
  supported levels for the selected model and provider. Disable it when support
  is unknown or absent. Model-list customization lives in Settings. Model
  changes do not insert visible notices into conversation history.
- **Pinned:** manually pinned entries and all folders. Folder contents count as
  pinned. Folders cannot live in any other section.
- **Other entries:** below Pinned, no folders; autoarchive after fourteen days
  of inactivity by default, configurable. Age labels use the theme's warning
  color during the final day and error color once due. Disabled autoarchive,
  pinned or Essential entries, folder contents, bot chats, active runs, and
  pending input are exempt. Bot chats never autoarchive, regardless of
  inactivity. Restoring an entry restarts this clock.
- Settings → Conversations & archive selects the shared default profile for new
  conversations. Bot conversations keep their own profiles; the sidebar has no
  profile picker.
- **Archived:** at the bottom; collapsed initially; newest ten archived entries,
  “Show 10 more,” and an Unarchive action on each. Unarchive returns an entry to
  ordinary unpinned navigation and restarts its inactivity window.
- Organization, ordering, and archive changes sync across devices. Current view,
  scroll, and whether Archive is expanded remain local to each browser.
- Desktop uses a sidebar; mobile uses bottom sheets instead. Selecting an entry
  closes the navigation sheet. Editors, documents, and substantial settings can
  occupy the current full-screen view. No internal tabs or split panes.
- While a turn runs, show readable activity/progress. On completion, retain its
  final answer and collapse intermediate work beneath “Worked for __m __s.”
  Place this summary directly after its user prompt, before the answer. Keep
  previous conversation turns. [T3 Code](https://github.com/pingdotgg/t3code) is
  the presentation reference, not a dependency. Do not transmit reasoning to the
  UI, including through replay, restored transcripts, or subagent views.

Interpretation to validate in the first slice: inactivity means messages/run
activity rather than merely opening a conversation. Active runs and pending
input should not autoarchive. Archiving a bot entry must not delete/disable its
profile, stop schedules, or stop Hermes work. These are proposed edge-case rules
from the discussion, not claims about existing Hermes behavior.

## Delivery boundary

Sign-in uses the Hermes dashboard username and password, with standard browser
and password-manager autofill fields. Device names are assigned automatically
and can be changed in Settings → Access, where each browser can be revoked. The
sign-in page does not ask for a device name or authorization code.

The first slice covers device authorization, conversation
list/history/send/stream, the navigation contract, cached reopening, reconnect,
and revocation. Broader retained features follow without silently becoming
exclusions. Live voice and multi-bot groups remain deferred. Architecture, data
ownership, deployment, and the full acceptance workflow stay in
[ADR-0001](adr/0001-independent-solid-convex-client.md).

Assistant messages expose only Copy. User messages retain Copy, Edit and
resubmit, and Branch conversation. Branching from a user prompt includes its
assistant response and ends before the next user prompt.

Sidebar organization intentionally differs from desktop: Essentials is an
untitled icon grid with a searchable icon library; Pinned has no heading and
ends with a separator above ordinary threads. Archived is a muted expandable
section anchored above the footer. Search sits at the top right. The sidebar
footer has Artifacts and Settings on the left and New conversation on the right.
The header holds the gateway status control. Create a folder from a chat's Move
to folder menu; it starts as Untitled, contains that chat, and opens inline
rename. Chat and folder names can be renamed in place by double-clicking or
using their existing Rename controls. Delete appears only for archived chats.
The duplicate global conversation menu is removed; thread context menus remain.
On mobile the top bar shows the open thread with its context-menu action.
