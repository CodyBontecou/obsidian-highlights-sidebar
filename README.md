# Highlights & Comments Sidebar

An [Obsidian](https://obsidian.md) plugin that extracts **highlights**, **comments**, and **footnotes** from the active note and displays them in a searchable, sortable sidebar pane.

![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed)

## Features

### Supported syntax

| Syntax | Type | Example |
|---|---|---|
| `==text==` | Highlight | `==important idea==` |
| `<mark>text</mark>` | Highlight | `<mark>key point</mark>` |
| `%%text%%` | Comment | `%%review this later%%` |
| `<!-- text -->` | Comment | `<!-- TODO: expand -->` |
| `[^id]: text` | Footnote | `[^1]: See appendix A.` |

### Core

- **Grouped by type** — Highlights, Comments, and Footnotes in collapsible sections
- **Click to navigate** — clicking any item scrolls to and selects its location in the editor
- **Auto-refresh** — the sidebar updates when you switch notes or edit content (debounced)
- **Line numbers** — displayed on the left of each item for quick reference

### Search & sort

- **Search bar** — filter items across all sections in real time
- **Per-section sorting** — click the sort icon on any section header to choose:
  - Line ↑ (top → bottom)
  - Line ↓ (bottom → top)
  - Alphabetical (A → Z)
  - Alphabetical (Z → A)
- **Right-click context menu** — right-click a section header for sort options and hide/show controls

### Section visibility

- **Toggle bar** — pill-shaped buttons at the top let you show/hide Highlights, Comments, or Footnotes independently
- **Right-click** any toggle button for a context menu to show/hide sections or show all
- **Persistent** — visibility and collapse state are saved across sessions

### Settings

- **Font size** — adjustable slider (10–24px) in Settings → Highlights & Comments Sidebar
- **Font size commands** — "Increase sidebar font size" and "Decrease sidebar font size" available in the command palette
- **Default sort order** — choose a global default sort for all sections
- **Section visibility toggles** — enable/disable each section from settings

### Access

- **Ribbon icon** — one-click toggle from the left ribbon
- **Command palette** — search "Toggle Highlights & Comments Sidebar"

## Installation

### From Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for "Highlights & Comments Sidebar"
3. Click **Install**, then **Enable**

### From source (manual)

```bash
# Clone into your vault's plugins directory
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/CodyBontecou/obsidian-highlights-sidebar.git
cd obsidian-highlights-sidebar

# Install dependencies and build
npm install
npm run build

# Restart Obsidian, then enable "Highlights & Comments Sidebar" in
# Settings → Community plugins
```

### Development

```bash
npm install
npm run dev    # watch mode with live rebuild
```

## Usage

1. **Open the sidebar** — click the highlighter icon in the left ribbon, or run the command _Toggle Highlights & Comments Sidebar_ from the command palette (`Cmd/Ctrl + P`).
2. **Search** — type in the search bar to filter items across all sections.
3. **Toggle sections** — use the pill buttons to show/hide Highlights, Comments, or Footnotes. Right-click for more options.
4. **Sort** — hover over a section header to reveal the sort icon. Click it to pick a sort order, or right-click the header for a context menu.
5. **Navigate** — click any item to jump to its location in the editor. The match is selected so you can see it immediately.
6. **Adjust font size** — go to Settings → Highlights & Comments Sidebar, or use the command palette commands.
7. **Edit freely** — the sidebar refreshes automatically as you type.

## Build

```bash
npm run build
```

Produces `main.js` (bundled) in the project root alongside `manifest.json` and `styles.css` — the three files Obsidian needs to load the plugin.


## Inspiration

This plugin was built in response to a request by u/bamajon1974 in [this Reddit thread](https://www.reddit.com/r/ObsidianMD/comments/1r8vw0w/anyone_have_a_plugin_request/) — a sidebar that extracts highlights, comments, and footnotes. The v1.1.0 update incorporates their detailed feedback on sorting, searching, section management, and readability.

## License

MIT
