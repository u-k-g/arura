Arura is a minimal web ui for the hermes agent.

Read [ADR-0001](docs/adr/0001-independent-solid-convex-client.md) when designing
or implementing the client, changing feature scope, or working on sync, storage,
access, or deployment. It records the accepted SolidJS/TypeScript and
self-hosted Convex direction.

Read [Product scope](docs/product-scope.md) when building or reviewing features.

## Reference repositories

- [Hermes Agent](https://github.com/NousResearch/hermes-agent): the runtime, desktop behavior, and more; Arura implements only the retained product scope which is most of the desktop behavior.
- [nc](https://github.com/u-k-g/nc) contains the host deployment configuration.
- [Macro](https://github.com/macro-inc/macro): well implemented SolidJS architecture, list performance, focus handling, and overall quality and design reference.
- [T3 Code](https://github.com/pingdotgg/t3code): live-work and completed-turn presentation; the product scope defines the exact behavior. well made, communicative and responsive ui.
- [Convex backend](https://github.com/get-convex/convex-backend): Arura's self-hosted sync layer; stores shared state and pushes changes to subscribed clients.
- [Convex JavaScript SDK](https://github.com/get-convex/convex-js): connects each browser to that sync layer through subscriptions and receives updates across devices.
- [SolidJS](https://github.com/solidjs/solid) + [Solid Router](https://github.com/solidjs/solid-router): frontend reactivity and navigation.
