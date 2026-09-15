# Visual reference

Arura follows
[Hermes desktop](https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop)
for layout, sizing, placement, and interaction, while retaining Iconoir,
Essentials/pinned folders, mobile bottom sheets, and the agreed exclusions.
Hermes defines layout and placement. Macro's light/dark color scheme remains the
default, alongside Grove, Jade, Black Rose, Gruvbox Dark Hard, and Rosé Pine in
Settings → Appearance → Theme.

The shell uses the desktop's 237px sidebar, 32px titlebar, tool navigation,
bottom profile/gateway controls, full-width messages, and compact composer with
its model picker beside the input. Colors follow
[Macro's theme definitions](https://github.com/macro-inc/macro/tree/main/apps/web/src/features/theme/themes):
neutral light surfaces, black/gray dark surfaces, and amber accents.

Additional palettes are bundled snapshots of the
[nc presets](https://github.com/u-k-g/nc/blob/main/modules/theme/default.nix).
Grove (T3 Code), Jade (steez), and Black Rose (metalelf0) are defined there;
Gruvbox Dark Hard and Rosé Pine come from its pinned
[ThemeNix revision](https://github.com/RGBCube/ThemeNix/tree/3779a7ba289d88ea092063e8bc512cfe80f293ba).
They use the same Base16 color mapping as the old client's theme adapter: base00
canvas, base01 sidebar/dialog, base02 surfaces/borders, base05 text, base04
secondary text, base03 subtle text, base0D accent, and base08 errors. These five
presets are dark palettes regardless of the device's appearance. Selection is
saved per browser. Arura does not read, follow, or update nc's active theme; no
Nix dependency or runtime theme request is required.

IBM Plex Sans is bundled from the
[existing client's assets](https://github.com/u-k-g/hermes-agent-desktop-web/tree/main/apps/web/src)
with its [OFL license](https://github.com/IBM/plex/blob/master/LICENSE.txt).
Code uses the same client's Iosevka font, subset to Latin, punctuation, currency
and arrows to avoid shipping its unused Nerd Font icon glyphs. Its OFL license
is bundled alongside it. Fonts load locally and are cached offline.

Sidebar collapse is stored per device. Search and action menus remain keyboard
accessible. Mobile navigation and action menus use bottom sheets. Internal tabs,
split panes, terminal, native controls and voice tools remain excluded. Macro
remains an engineering and file-editor reference.

App branding uses unmodified assets from
[Hermes Agent at `1ad89ac018f2`](https://github.com/NousResearch/hermes-agent/tree/1ad89ac018f26a4f21817ebf37bb09f508656d63):
[desktop app icon](https://github.com/NousResearch/hermes-agent/blob/1ad89ac018f26a4f21817ebf37bb09f508656d63/apps/desktop/assets/icon.png)
and
[website favicon](https://github.com/NousResearch/hermes-agent/blob/1ad89ac018f26a4f21817ebf37bb09f508656d63/website/static/img/favicon-32x32.png).
They are bundled in `public/hermes` with the upstream license and cached
offline. The desktop asset also supplies the browser installation and Apple
touch icon. Interface controls continue to use Iconoir.
