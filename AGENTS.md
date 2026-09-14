Arura is a minimal web ui for the hermes agent.

App keyboard shortcuts are disabled for now, including Enter-to-send and file
save shortcuts. Keep actions available through buttons. Preserve ordinary text
editing, browser shortcuts and accessible focus/menu navigation.

Read [ADR-0001](docs/adr/0001-independent-solid-convex-client.md) when designing
or implementing the client, changing feature scope, or working on sync, storage,
access, or deployment. It records the accepted SolidJS/TypeScript and
self-hosted Convex direction.

Read [Product scope](docs/product-scope.md) when building or reviewing features.

## Reference repositories

- [Hermes Agent](https://github.com/NousResearch/hermes-agent): runtime and
  visual/interaction reference. Match desktop placement for the retained scope
  with Iconoir equivalents, but keep Macro's color scheme. Keep supported data
  authoritative in Hermes; Arura stores only synchronized copies and web-only
  additions.
- [nc](https://github.com/u-k-g/nc) contains the host deployment configuration.
- [Macro](https://github.com/macro-inc/macro): SolidJS architecture, list
  performance, focus handling, and file-editor reference. Hermes defines the UI.
- [T3 Code](https://github.com/pingdotgg/t3code): live-work and completed-turn
  presentation; the product scope defines the exact behavior. well made,
  communicative and responsive ui.
- [Convex backend](https://github.com/get-convex/convex-backend): Arura's
  self-hosted sync layer; stores shared state and pushes changes to subscribed
  clients.
- [Convex JavaScript SDK](https://github.com/get-convex/convex-js): connects
  each browser to that sync layer through subscriptions and receives updates
  across devices.
- [SolidJS](https://github.com/solidjs/solid) +
  [Solid Router](https://github.com/solidjs/solid-router): frontend reactivity
  and navigation.
