# Deployment

Arura runs three components: the Deno HTTP adapter serving the built SolidJS app,
the self-hosted Convex backend, and your existing Hermes dashboard API. Hermes
continues to own agent execution and its configuration. The NixOS module manages
the first two components; it does not install or alter Hermes.

## Package and services

The flake exports `packages.x86_64-linux.arura`, `packages.x86_64-linux.convex`,
and `nixosModules.default`. The application package builds with Deno and includes
its runtime dependencies. It starts without downloading packages.

Import the module and configure `services.arura`:

| Option | Meaning |
| --- | --- |
| `enable` | Start Arura and its Convex service. |
| `publicUrl` | HTTPS origin used by browsers to open Arura. |
| `convexPublicUrl` | HTTPS origin used by browser Convex subscriptions. |
| `hermesUrl` | Dashboard API reachable from the host adapter. |
| `environmentFile` | Private runtime file containing Arura access and Hermes credentials. |
| `convexEnvironmentFile` | Private runtime file containing the Convex instance identity. |
| `port`, `convexPort`, `convexSitePort` | Local listeners, defaulting to 4100, 3210, and 3211. |

Use your host's secret management to supply the files. Their contents must remain
outside the Nix store. Both services use private persistent state directories and
unprivileged dynamic users. Route Arura's public origin to its local port, and the
Convex public origin to the Convex port with WebSocket forwarding enabled. Keep
the dashboard API and Convex administration credentials private.

## Instance initialization

Create a stable random Convex instance name and 32-byte hexadecimal secret, and
store them as `CONVEX_INSTANCE_NAME` and `CONVEX_INSTANCE_SECRET` in the private
Convex environment file. Preserve them with the database across upgrades.

Arura's environment file needs `ARURA_ACCESS_KEY` and either
`HERMES_USERNAME`/`HERMES_PASSWORD` or a supported `HERMES_TOKEN`.
`HERMES_AUTH_PROVIDER` is optional when Hermes advertises a single password
provider. The adapter discovers that provider before logging in.

Before the first function deployment, generate Arura's signing identity with
`deno task setup` using the same `ARURA_STATE_DIR` and `ARURA_AUTH_ISSUER` that the
service will use. Ensure the service can read its private signing key. The issuer
must match the public Arura origin. This step also generates a bootstrap access
key in a private `.env` for local setup; provision the deployment's access key
through its environment file.

Generate the self-hosted administrator key using the pinned backend's
`keygen admin-key` command with the instance name and secret. Supply that key as
`CONVEX_SELF_HOSTED_ADMIN_KEY`, and the reachable backend URL as
`CONVEX_SELF_HOSTED_URL`, to the following command from the checkout:

```sh
deno install --frozen
deno task deploy:functions
```

The deployment task sets the issuer and public signing key in your Convex instance
and deploys the functions. It requires explicit self-hosted credentials and never
chooses a hosted Convex account. CLI-generated files are isolated in a private
temporary directory. Repeat this deployment when Convex functions or schema change.
Restart the application service after updating its package.

## Provider callbacks

MCP OAuth also needs a browser-reachable callback. In the Hermes configuration,
set the server's `mcp_servers.NAME.oauth.redirect_uri` to the Arura public origin
followed by `/api/mcp/oauth/callback/NAME`, URL-encoding the server name. Arura
forwards only that callback route to Hermes, which validates the one-time OAuth
state. Authorization initiation, polling, and cancellation still require an
authorized device. The provider-issued authorization URL is opened unchanged.
Existing providers may require registering that redirect URI. Provider device-code
sign-in uses its own verification page and does not need this callback.

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
folders, preferences, and conversation organization; it is not a complete service
backup or an automatic restore workflow. Diagnostic downloads remain local.

Deploy beside the existing web client first, using separate origins, listeners,
and state. Validate real sending, reconnects, and device revocation from both a
phone and desktop before changing the main route. The package has passed isolated
browser integration tests; live Hermes validation so far covers authenticated
read-only APIs and the WebSocket handshake. A live NixOS rollout remains pending.
