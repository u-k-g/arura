# Visual reference

Arura follows [Macro](https://github.com/macro-inc/macro)'s current application
styling while keeping Iconoir, single-view navigation, Essentials/pinned
folders, and mobile bottom sheets.

The reference is Macro's
[theme definitions](https://github.com/macro-inc/macro/tree/main/apps/web/src/features/theme/themes)
and
[global styles](https://github.com/macro-inc/macro/blob/main/apps/web/src/index.css):
neutral OKLCH light/dark surfaces, amber accent, half-pixel dividers, a 920px
message area, 14px controls, 16px reading text, and Apple system fonts with
Inter as the non-Apple fallback. Code uses Roboto Mono. Arura owns its CSS and
components; Macro's workspace, internal tabs, and icon set are not included.

Inter and Roboto Mono Latin variable fonts are bundled from Fontsource 5.2.8.
Both use the SIL Open Font License; copies accompany the fonts in
`public/fonts`. Fonts load from this host and are included in the application's
offline cache.

Compatible Macro interaction patterns include the collapsible 60px icon rail,
breadcrumb navigation, quick conversation pinning, anchored desktop action
menus, and grouped keyboard-driven search. The home view links to existing
conversations and tools. Sidebar collapse is stored per device; pins still sync.
Mobile navigation and action menus use bottom sheets. Internal tabs, split
panes, and Macro-specific product features remain excluded.
