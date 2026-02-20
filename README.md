# Highlights & Comments Sidebar

An [Obsidian](https://obsidian.md) plugin that extracts **highlights**, **comments**, and **footnotes** from the active note and displays them in a collapsible sidebar pane.

![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed)

## Features

| Syntax | Type | Example |
|---|---|---|
| `==text==` | Highlight | `==important idea==` |
| `<mark>text</mark>` | Highlight | `<mark>key point</mark>` |
| `%%text%%` | Comment | `%%review this later%%` |
| `<!-- text -->` | Comment | `<!-- TODO: expand -->` |
| `[^id]: text` | Footnote | `[^1]: See appendix A.` |

- **Grouped by type** — Highlights, Comments, and Footnotes in collapsible sections
- **Click to navigate** — clicking any item scrolls to and selects its location in the editor
- **Auto-refresh** — the sidebar updates when you switch notes or edit content (debounced)
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
git clone https://github.com/your-user/obsidian-highlights-sidebar.git
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
2. **Browse items** — highlights, comments, and footnotes from the active note appear in collapsible groups.
3. **Navigate** — click any item to jump to its location in the editor. The match is selected so you can see it immediately.
4. **Edit freely** — the sidebar refreshes automatically as you type.

## Build

```bash
npm run build
```

Produces `main.js` (bundled) in the project root alongside `manifest.json` and `styles.css` — the three files Obsidian needs to load the plugin.


## Inspiration

This plugin was built in response to a request by u/bamajon1974 in [this Reddit thread](https://www.reddit.com/r/ObsidianMD/comments/1r8vw0w/anyone_have_a_plugin_request/) — a sidebar that extracts highlights, comments, and footnotes.

## License

MIT
