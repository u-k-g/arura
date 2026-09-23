# Deployment

Arura runs three components: the Deno HTTP adapter serving the built SolidJS
app, the self-hosted Convex backend, and your existing Hermes dashboard API.
Hermes continues to own agent execution and its configuration. The NixOS module
manages the first two components; it does not install or alter Hermes. Connect
Arura to the Hermes dashboard API, not the separate messaging/cron gateway
service. Keep that gateway's existing lifecycle under host management.

## Package and services

The flake exports `packages.x86_64-linux.arura`, `packages.x86_64-linux.convex`,
and `nixosModules.default`. The application package builds with Deno and
includes its runtime dependencies. It starts without downloading packages.

Import the module and configure `services.arura`:

| Option                                 | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `enable`                               | Start Arura and its Convex service.                                  |
| `publicUrl`                            | HTTPS origin used by browsers to open Arura.                         |
| `convexPublicUrl`                      | HTTPS origin used by browser Convex subscriptions.                   |
| `hermesUrl`                            | Dashboard API reachable from the host adapter.                       |
| `environmentFile`                      | Private runtime file containing Arura access and Hermes credentials. |
| `convexEnvironmentFile`                | Private runtime file containing the Convex instance identity.        |
| `deployFunctions`                      | Deploy the matching packaged functions at startup; defaults to true. |
| `port`, `convexPort`, `convexSitePort` | Local listeners, defaulting to 4100, 3210, and 3211.                 |

Use your host's secret management to supply the files. Their contents must
remain outside the Nix store. Both services use private persistent state
directories and unprivileged dynamic users. Route Arura's public origin to its
local port, and the Convex public origin to the Convex port with WebSocket
forwarding enabled. Keep the dashboard API and Convex administration credentials
private.

## Instance initialization

Create a stable random Convex instance name and 32-byte hexadecimal secret, and
store them as `CONVEX_INSTANCE_NAME` and `CONVEX_INSTANCE_SECRET` in the private
Convex environment file. Preserve them with the database across upgrades.

Arura's environment file needs either `HERMES_USERNAME`/`HERMES_PASSWORD` or a
supported `HERMES_TOKEN`. `HERMES_AUTH_PROVIDER` is optional when Hermes
advertises a single password provider. The adapter discovers that provider
before logging in.

Browsers sign in with the existing Hermes dashboard username and password.
Hermes must have a password authentication provider configured. Arura validates
credentials with Hermes, then issues its own revocable browser session without
storing the supplied password. `ARURA_ACCESS_KEY` is only used by legacy clients
that still submit device codes; it is not needed by the current sign-in form.

File uploads use the directory advertised by Hermes's files API. Set
`ARURA_UPLOAD_DIR` only to override that location on the Hermes host. Arura
sends uploads through the dashboard API; its service does not need a mount of
the Hermes filesystem.

The module deploys the package's Convex functions before starting Arura by
default (`services.arura.deployFunctions = true`). Include
`CONVEX_SELF_HOSTED_ADMIN_KEY` in Arura's private environment file. Generate it
with the pinned backend's `keygen admin-key` command using the same instance
name and secret as the Convex service. Keep this key outside the Nix store.

The packaged `arura-deploy-functions` command waits for the local backend,
creates or reuses Arura's signing identity in its persistent state directory,
sets the issuer/public key, and deploys the matching functions and schema. The
HTTP server starts only after deployment succeeds. Package updates therefore
update functions on service restart without requiring a checkout or downloading
dependencies. The private signing key remains in the service state directory.
The packaged deployer disables the CLI's crash reporting and grants it network
access only to the configured Convex endpoint. The backend's beacon is disabled
by the module. The application's browser and host services do not use external
analytics or hosted synchronization.

For installations that manage function deployment separately, set
`services.arura.deployFunctions = false`. Run `arura-deploy-functions` with
`ARURA_STATE_DIR`, `ARURA_AUTH_ISSUER`, `CONVEX_SELF_HOSTED_URL`, and
`CONVEX_SELF_HOSTED_ADMIN_KEY` set for the target installation, using the same
identity and issuer as the HTTP service. The checkout equivalent remains
`deno task deploy:functions` inside the development shell.

## Provider callbacks

MCP OAuth also needs a browser-reachable callback. In the Hermes configuration,
set the server's `mcp_servers.NAME.oauth.redirect_uri` to the Arura public
origin followed by `/api/mcp/oauth/callback/NAME`, URL-encoding the server name.
Arura forwards only that callback route to Hermes, which validates the one-time
OAuth state. Authorization initiation, polling, and cancellation still require
an authorized device. The provider-issued authorization URL is opened unchanged.
Existing providers may require registering that redirect URI. Provider
device-code sign-in uses its own verification page and does not need this
callback.

## Maintenance actions

`ARURA_ACTIONS_FILE` may point to a host-managed JSON file containing `restart`
and/or `update`. Each entry has a `label`, `command` executable, and optional
`args` array. The server invokes that predefined executable without a shell;
browsers cannot choose commands. Supply wrappers appropriate to your deployment,
with the service permissions needed for those specific operations. Nix-managed
installations can use host-managed wrappers; conventional installations can use
their normal maintenance procedure. Missing actions are not shown.

## State and rollout

Back up Hermes state, Convex's complete persistent database/storage, Arura's
signing identity, and the private instance configuration using a consistent host
backup procedure. Arura's downloadable organization backup currently contains
folders, preferences, and conversation organization; it is not a complete
service backup or an automatic restore workflow. Hermes backup creation reports
shared progress and exposes its archive download only after the corresponding
host process exits successfully. A separate workspace download contains
web-owned organization. Diagnostic downloads remain local.

For a recoverable whole-service snapshot, stop `arura.service` and
`arura-convex.service`, quiesce Hermes using the host's own service declaration,
and capture their persistent state together with the private environment files.
The module's systemd state directories are named `arura` and `arura-convex`;
include their actual contents, including Convex storage and SQLite sidecars, and
preserve file permissions. Record the Arura package revision and Hermes revision
with the snapshot. Restart the services after capture. Restore while the
services are stopped, using the matching package revisions and instance identity
before attempting upgrades. Do not copy an actively changing Convex database as
a standalone file. Device authentication depends on retaining both the database
and Arura signing identity.

Deploy Arura on its own origin with separate listeners and state. Validate real
sending, reconnects, and device revocation from both a phone and desktop before
changing the main route. The package has passed isolated browser integration
tests. A disposable installation of the pinned
Hermes runtime also passes local configuration and lifecycle writes, real backup
creation/download, gateway streaming, automation controls, and transcript
filtering against a local inference stub. These checks do not change the
production Hermes installation. Manara's NixOS rollout also passes public HTTPS
device authorization, authenticated Convex queries, existing-history ingestion,
and device revocation. Real inference and phone suspension/reconnection still
need a device-level acceptance check.

## Upstream limitations

- Hermes replay is bounded and does not provide an atomic snapshot with a replay
  cursor. Arura recovers through snapshots; changes originating outside Arura
  can arrive after reconciliation rather than immediately. An unacknowledged
  prompt can have an unknown outcome, so check the conversation before
  resending.
- File and configuration saves check for conflicts, but Hermes provides no
  atomic compare-and-swap against other writers on the host.
- In the audited Hermes revision, the Mixture of Agents preset endpoint clears
  an existing `privacy_filter`. Arura preserves it by blocking preset rename and
  deletion when a filter is configured. See the pinned
  [upstream route](https://github.com/NousResearch/hermes-agent/blob/ee4452991d17534aa561f31ee55596d082aa94e7/hermes_cli/web_routers/models.py).

## Manara deployment in nc

[nc's Arura module](https://github.com/u-k-g/nc/blob/main/modules/arura.mod.nix)
imports this flake's services and connects them to the same Hermes dashboard.
Hermes remains authoritative for history; Arura's separate Convex database
stores its projection, organization, and device access.
It does not create another Hermes installation or copy its database.

Arura uses tailnet HTTPS port **8444**, with browser Convex subscriptions on
**8445**. The Hermes web route stays on **8443**. Each route has its
own foreground Tailscale Serve service, so stopping Arura does not remove the
other routes.

The initialization service creates private instance credentials once and reuses
the existing Hermes dashboard password. Preserve its `arura-credentials` state
directory along with `arura` and `arura-convex`. Manara declares persistent
mounts for all three because its root filesystem is ephemeral. On an existing
installation, create the new backing subvolumes before activating those mounts;
do not rerun disk formatting. The initial device access code is the
`ARURA_ACCESS_KEY` entry in the root-only Arura environment file. Authorize
subsequent devices through Access settings.

The nc input pins a published Arura revision. Update that input when publishing
an application release, then build and activate the host configuration. The
remaining production checks are real OpenCode Go inference, phone
suspension/reconnection, measured phone load time, and device revocation through
the production routes. Optional restart/update wrappers and whole-service backup
scheduling remain host administration choices.
