# QMD Integration Alternatives

Research into how the Obsidian plugin should connect to QMD for search.

## Option A: HTTP Daemon (recommended)

Start `qmd mcp --http --daemon` as a child process on plugin load, communicate via HTTP API at `localhost:<port>`.

**How it works:**
- Plugin spawns QMD daemon in `onload()`
- All search queries go through `POST http://localhost:<port>/query`
- Plugin kills the daemon in `onunload()`
- If Obsidian crashes (no clean unload), orphaned process is cleaned up on next startup

**Pros:**
- Simple HTTP calls from the plugin — no native module concerns
- Shares the existing index at `~/.cache/qmd/index.sqlite` by default
- Models stay warm after first load — fast subsequent queries
- Clean separation of concerns

**Warmup strategy:**
Fire a lightweight query (e.g. BM25-only or a minimal expand) immediately after daemon startup to force model loading. This way the first real user query hits warm models.

**Cons:**
- Requires QMD CLI installed on the system
- Managed child process adds complexity (startup, shutdown, crash recovery)

## Option B: Node.js Library

Use `@tobilu/qmd` (npm) as a direct dependency, calling `createStore()` programmatically.

**How it works:**
```typescript
import { createStore } from '@tobilu/qmd'

const store = await createStore({
  dbPath: '~/.cache/qmd/index.sqlite'  // shares CLI's index
})

const results = await store.search({ query: "...", collection: "obsidian" })
await store.close()
```

**Available API:**
- `store.search()` — full hybrid (expand + rerank)
- `store.searchLex()` — BM25 keyword only, ~0.3s
- `store.searchVector()` — vector similarity only
- `store.expandQuery()` — manual query expansion
- `store.get()` / `store.multiGet()` — document retrieval
- LLM models are lazy-loaded and auto-unloaded after inactivity — but stay warm in-process between queries, so only the first query pays the model loading cost

**Pros:**
- No external dependency at runtime — QMD CLI doesn't need to be installed
- Cleanest integration — direct function calls, no HTTP overhead
- Full programmatic control over search behavior
- Shares the same SQLite index if pointed at `~/.cache/qmd/index.sqlite`

**Cons:**
- **Native module compatibility is a major concern.** QMD depends on `better-sqlite3` and `node-llama-cpp`, both C++ native modules. Obsidian plugins run inside Electron, which has a specific Node ABI. Native modules must be compiled against Electron's ABI, not the system Node.js. This may require `electron-rebuild` or similar tooling and could break across Obsidian updates.
- Heavier plugin bundle — ships native binaries
- Unknown whether Obsidian's sandboxing allows loading native extensions

## Performance Benchmarks

### CLI subprocess (per-invocation)

Measured on AMD Ryzen 7 7840U, Radeon 780M, 32GB RAM:

| Mode | Command | Time | Notes |
|------|---------|------|-------|
| Full hybrid (1st) | `qmd query --json "..."` | 33.8s | Cold — model load + expand + rerank |
| Full hybrid (2nd) | `qmd query --json "..."` | 32.6s | No cache benefit, models reload |
| BM25 only | `qmd search --json "..."` | 0.35s | No LLM, near-instant |

Key finding: **subprocess calls don't benefit from warm caches.** Each invocation loads models from scratch, making per-query subprocess spawning impractical for semantic search. This rules out a "spawn qmd per query" approach.

### Persistent process (daemon or library)

With either the HTTP daemon or the Node.js library, models stay loaded in memory between queries. Only the first query (or a warmup query) pays the ~30s model loading cost. Subsequent queries should be significantly faster. Exact warm-query latency TBD — needs benchmarking with the daemon or library running.

## Decision

Start with **Option A (HTTP Daemon)** as the primary integration path. If we hit blockers with process management or the daemon mode, revisit **Option B** — but only after investigating Electron native module compatibility.
