# Arura

A SolidJS web client for a self-hosted Hermes agent, with a Deno adapter and
self-hosted Convex synchronization. Desktop navigation uses Essentials, pinned
folders, recent conversations, and an archive; mobile navigation uses sheets.

The retained feature specification is in [Product scope](docs/product-scope.md).
The [completion audit](docs/completion-audit.md) records implementation evidence,
upstream constraints, and the production checks that follow deployment. The
packaged application and NixOS module are ready for the
[nc integration step](docs/deployment.md#handoff-to-nc); production hosting and
the existing Hermes service remain owned by that host configuration.

## Develop

```sh
nix develop
deno install --frozen
deno task setup
```

Configure the Hermes connection in the private `.env` file, then run:

```sh
deno task dev
```

Open the Vite address printed by the command. Authorize the first browser using
the `ARURA_ACCESS_KEY` generated in `.env`. Use Settings → Access to authorize
additional browsers with expiring invitations and revoke individual devices.

On x86-64 Linux the development task starts the pinned Convex backend, preserves
its database in `.state/convex`, deploys the functions, and starts the Deno
adapter and Vite. Other platforms can supply a compatible
`ARURA_CONVEX_EXECUTABLE`, or use `deno task dev:external` with an already
configured self-hosted instance. Development servers bind locally. Remote
devices require browser-reachable HTTPS origins for both Arura and Convex.

## Verify and package

```sh
deno task test:integration
deno task format:check
deno task lint
nix build .#arura --no-link
```

The integration runner uses disposable local services and credentials. It does
not send prompts to the configured Hermes installation.

See [Development](docs/development.md) for the toolchain and
[Deployment](docs/deployment.md) for persistent services, credentials, and
routing.
