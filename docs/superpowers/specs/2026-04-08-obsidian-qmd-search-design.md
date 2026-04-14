# obsidian-qmd-search — Design Spec

## Overview

An Obsidian community plugin that adds a QMD-powered search sidebar with progressive refinement. BM25 keyword results appear instantly as the user types, then semantic results from QMD's hybrid search (query expansion + LLM reranking) are added progressively.

## Goals

- Provide fast, high-quality search over an Obsidian vault using QMD
- Instant feedback via BM25, with semantic depth via hybrid search
- Minimal setup — the plugin manages the QMD daemon lifecycle
- Results only grow — once a result is shown, it stays in place (no disappearing, no reordering)

## Non-Goals

- Replacing Obsidian's built-in search
- A standalone indexing/embedding management UI. However, buttons to trigger indexing and embedding manually (e.g. "Re-index vault", "Update embeddings") should be available in the settings page, onboarding flow, and/or the search panel itself (e.g. a status bar showing indexing progress or a re-index action)
- Supporting QMD as a Node.js library (documented as future alternative)
- Multi-vault support — v1 assumes a single active vault and daemon instance
- Cross-platform support beyond Linux — Windows/macOS may need platform-specific process management (signal handling, path resolution). Out of scope for v1

## User Experience

### Search Flow

1. User opens the QMD search sidebar via command palette or ribbon icon
2. User types a query in the search input
3. After a short debounce (~150ms), BM25 results appear sorted by keyword relevance
4. After a longer debounce (~500ms-1s, TBD), a hybrid query fires in the background
5. Hybrid results are added to the list. Duplicates are allowed — a document may appear in both BM25 and hybrid results, showing both scores. Whether to deduplicate or keep duplicates is TBD
6. If the user modifies the query while a hybrid search is in-flight, the stale response is discarded

### Result Display

Each result shows:
- Note title/path
- Matching snippet with context
- Relevance score
- Match type indicator (keyword vs semantic)

Clicking a result opens the note and scrolls to the matching section. QMD returns snippet data with line offset information (e.g. `@@ -6,4 @@ (5 before, 2 after)`). The plugin uses this to scroll to the match location. If line data is unavailable, falls back to opening the note at the top.

### Error Handling

- QMD not installed or daemon fails to start: onboarding flow (dialog or settings page, TBD)
- Daemon dies mid-session: attempt automatic restart, show notice if restart fails
- Query fails: inline error in search view

## Architecture

### Components

1. **QmdPlugin** (`main.ts`) — Plugin entry point. Registers the sidebar view, command, ribbon icon, and settings tab. Manages daemon lifecycle via QmdDaemonManager.

2. **QmdDaemonManager** (`daemon.ts`) — Spawns `qmd mcp --http --daemon` as a child process on plugin load. Monitors health. Fires a warmup query after startup to pre-load LLM models. Kills the daemon on plugin unload. Cleans up orphaned processes from unclean shutdowns on next startup.

3. **QmdSearchView** (`view.ts`) — Obsidian `ItemView` registered as a sidebar leaf (dockable left/right). Contains the search input and results list. Manages two debounce timers (BM25 and hybrid) and stale query cancellation.

4. **QmdClient** (`client.ts`) — HTTP client wrapper for the QMD daemon API. Methods: `searchLex(query, options)` and `searchHybrid(query, options)`. Handles connection errors and timeouts (default: 5s for BM25, 60s for hybrid to accommodate model inference).

5. **QmdSettingsTab** (`settings.ts`) — Plugin settings UI with fields for QMD binary path, daemon host/port, and collection name. May include onboarding flow if QMD is not detected.

### Data Flow

```
User types
  → QmdSearchView (debounce 150ms) → QmdClient.searchLex() → HTTP → QMD Daemon
  → QmdSearchView (debounce 500ms+) → QmdClient.searchHybrid() → HTTP → QMD Daemon
                                              ↓
                                    Results rendered in sidebar
                                    (BM25 first, hybrid appended — dedup TBD)
```

### QMD Integration

Primary integration path: HTTP daemon. See `docs/qmd-integration-alternatives.md` for full analysis of alternatives.

- Plugin spawns `qmd mcp --http --daemon` in `onload()`
- QmdDaemonManager parses daemon stdout to discover the assigned port
- All queries go through `POST http://localhost:<port>/query`
- Daemon is killed in `onunload()` via the child process handle
- On startup, checks for orphaned daemon from a prior unclean shutdown by writing/reading a PID file at `<vault>/.obsidian/plugins/obsidian-qmd-search/qmd.pid`. Before killing, verifies the process command matches `qmd` to avoid PID-reuse collisions
- A warmup hybrid query is sent after daemon startup to pre-load the expansion and reranking models. Uses a short fixed query (e.g. `"warmup"`) to trigger model loading. Runs asynchronously — does not block the UI. Expected warmup latency: ~30s based on benchmarks

**QMD API contract** (based on QMD HTTP API):
```json
// Request: POST http://localhost:<port>/query
{
  "searches": [
    { "type": "lex", "query": "search terms" }
  ],
  "collections": ["obsidian"],
  "limit": 20
}

// Hybrid request (full expand + rerank):
{
  "searches": [
    { "type": "lex", "query": "search terms" },
    { "type": "vec", "query": "natural language question about search terms" }
  ],
  "collections": ["obsidian"],
  "limit": 20
}
// Or use auto-expand (QMD generates optimal sub-queries):
{
  "searches": [
    { "type": "expand", "query": "search terms" }
  ],
  "collections": ["obsidian"],
  "limit": 20
}

// Response: array of results
[
  {
    "docid": "#419d76",
    "score": 0.9,
    "file": "qmd://obsidian/path/to/note.md",
    "title": "Note Title",
    "context": "Collection context",
    "snippet": "@@ -6,4 @@ (5 before, 2 after)\nMatching content..."
  }
]
```

**Bootstrapping:** If the collection does not exist or the index is empty when the daemon starts, queries will return empty results. The plugin should detect this and guide the user through collection setup (see open questions 3 and 4).

## Tech Stack & Project Structure

```
obsidian-qmd-search/
├── src/
│   ├── main.ts              # QmdPlugin — lifecycle
│   ├── daemon.ts            # QmdDaemonManager — process management
│   ├── client.ts            # QmdClient — HTTP wrapper
│   ├── view.ts              # QmdSearchView — sidebar UI
│   └── settings.ts          # QmdSettingsTab — settings/onboarding
├── styles.css               # Result cards, match indicators, etc.
├── manifest.json            # Obsidian plugin manifest
├── package.json             # Dependencies (obsidian API types only)
├── tsconfig.json            # TypeScript config
├── esbuild.config.mjs       # Build config
├── README.md                # Install/usage instructions
├── docs/
│   ├── qmd-integration-alternatives.md
│   └── superpowers/specs/
│       └── 2026-04-08-obsidian-qmd-search-design.md  (this file)
└── memory/
```

**README.md** should cover:
- What the plugin does
- Prerequisites (QMD installed)
- How to install and configure
- How progressive search works
- Ko-fi link for support/donations

**Build tooling:** esbuild (following Obsidian sample plugin conventions). `npm run dev` for watch mode.

**Runtime dependencies:** None beyond Obsidian's built-in APIs. QMD interaction is via HTTP (`fetch`) and process management (`child_process`).

## Settings

Minimal initial settings:
- **QMD binary path** — path to the `qmd` executable (auto-detected if on PATH)
- **Host/port** — daemon listen address (default: `localhost`, auto-assigned port)
- **Collection name** — which QMD collection to search (default: `obsidian`)
- **Max results** — limit sent to QMD per search stage (default: 20). No overall cap on displayed results for v1; if the combined list is too long, we can add pagination later
- **Ko-fi link** — displayed somewhere in the plugin (settings page, about section, or sidebar footer — TBD)

## Open Questions

1. **Onboarding location** — When QMD is not found, show onboarding in a dialog or in the settings page? Decision deferred.

2. **Vector search as middle stage** — Progressive refinement could be three stages (BM25 → vec → hybrid) instead of two (BM25 → hybrid). Decision deferred until daemon warm-query latency is benchmarked.

3. **Collection management** — Should the plugin create the QMD collection for the vault automatically, or require the user to configure it externally and reference it by name in settings?

4. **Index maintenance** — Should the plugin call `qmd update` and `qmd embed` automatically? Options:
   - On plugin load (ensure index is fresh at startup)
   - On file modification (keep index in sync with vault changes)
   - Before a query (guarantee fresh results, at cost of latency)
   - Some combination of the above

5. **Prepend vs append** — When hybrid results arrive, should they appear above or below existing BM25 results? Decision deferred until we see it in action.

6. **Hybrid debounce timing** — How long after the user stops typing before firing the hybrid query? (~500ms, 1s, only on Enter?) Decision deferred.

7. **Result deduplication** — When a document appears in both BM25 and hybrid results, should it be shown twice (showing both scores) or deduplicated? Decision deferred until we see it in action.

8. **Custom QMD index path** — Inside a Flatpak sandbox, `XDG_CACHE_HOME` is redirected to an app-specific directory. We currently strip it from the spawned env so qmd falls back to `$HOME/.cache`. This breaks if the host has a custom `XDG_CACHE_HOME` pointing elsewhere. A plugin setting for the qmd index path would cover this edge case.
