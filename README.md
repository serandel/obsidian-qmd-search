# QMD Search for Obsidian

An Obsidian plugin that adds QMD-powered search with progressive refinement. Keyword results appear instantly, then semantic results are added as they become available.

## How It Works

1. Type a query in the QMD Search sidebar
2. **Keyword matches** appear instantly via BM25 full-text search
3. **Semantic matches** are progressively added via QMD's hybrid search (query expansion + LLM reranking)

Results are grouped by match type. Keyword matches appear first; semantic matches are added without disturbing existing results.

## Prerequisites

- [QMD](https://github.com/tobi/qmd) installed and on your PATH

The plugin will guide you through the rest of the setup on first use: it detects whether a QMD collection exists for your vault and offers to create one, then handles indexing and embedding generation.

## Installation

1. Clone this repo into your vault's `.obsidian/plugins/` directory
2. Run `npm install && npm run build`
3. Enable "QMD Search" in Obsidian Settings → Community Plugins

## Settings

- **QMD binary path** — path to `qmd` (default: `qmd`)
- **Collection** — QMD collection name (default: `obsidian`)
- **Max results** — results per search stage (default: 20)

## Architecture Note

The QMD MCP server currently only exposes read-only tools (query, get, status). Index updates and embedding generation are performed via the CLI (`qmd update`, `qmd embed`) as separate processes. This means the plugin manages two interfaces to QMD: the daemon for search and the CLI for indexing. See [tobi/qmd#587](https://github.com/tobi/qmd/issues/587) for a request to add indexing tools to the MCP server.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

## Support

If you find this plugin useful, consider buying me a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/serandel)