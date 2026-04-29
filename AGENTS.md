# Agent Guide: QMD Search for Obsidian

This is an **Obsidian plugin** that integrates [QMD](https://github.com/tobi/qmd) for semantic search. The plugin manages both the QMD MCP server (for search queries) and QMD CLI (for indexing/embedding), providing a progressive search experience where keyword results appear instantly and semantic results replace them as they become available.

## Essential Commands

```bash
npm install           # Install dependencies
npm run build         # Production build (includes typecheck)
npm run dev           # Watch mode (no typecheck)
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
npm run lint          # Run ESLint
```

**Critical**: Always run `npm run build` before asking the user to test in Obsidian. The `dev` command produces code but doesn't error on type issues.

## Project Context

### Memory System

This project uses a **memory/** directory for session feedback files:
- Read **memory/MEMORY.md** for project-specific conventions
- **Never write memory files to `~/.claude/projects/`** — always use the repo's `memory/` directory
- Key conventions from memory:
  - Work directly on `main` (no feature branches)
  - Commit + push immediately after completing changes + passing tests
  - Always rebuild before asking user to test
  - Write tests for all changes, run `npm test` before committing
  - Use placeholder names (foo/bar/baz) in examples, not real note names
  - **All code must work cross-platform** (Windows, macOS, Linux)

### Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│ Obsidian Plugin (main.ts)                               │
│  ├─ QmdSearchView (view.ts)         [Search UI]         │
│  ├─ QmdMcpClient (mcp-client.ts)    [QMD MCP Server]   │
│  ├─ QmdIndexer (indexer.ts)         [CLI for updates]   │
│  ├─ QmdStatusBar (status-bar.ts)    [Status display]    │
│  └─ Settings (settings.ts)                              │
└──────────────────────────────────────────────────────────┘
         │                        │
         │ (search)               │ (update/embed)
         ▼                        ▼
    ┌─────────┐             ┌──────────┐
    │   MCP   │             │ QMD CLI  │
    │  Server │             │ Process  │
    └─────────┘             └──────────┘
         │                        │
         └────────────┬───────────┘
                      ▼
                 QMD Collection
```

**Dual Interface Design**: QMD's MCP server is currently read-only (query, get, status). Index updates and embedding generation happen via spawned CLI processes (`qmd update`, `qmd embed`). This creates two separate interfaces to manage. See `src/main.ts:89` for MCP connection and `src/indexer.ts` for CLI spawning.

**Why dual interface?**: Tracked in [tobi/qmd#587](https://github.com/tobi/qmd/issues/587). If QMD adds index management to MCP, the plugin can be simplified to a single interface.

### Core Workflows

**Search Flow** (view.ts):
1. User types → instant keyword search (BM25 via `searchLex`)
2. Debounce fires → lexical search runs
3. User hits Enter → hybrid search (lex + vec + LLM reranking) replaces keyword results
4. Results rendered with `matchType` indicator (keyword vs hybrid)

**Indexing Flow** (indexer.ts):
1. File change detected (debounced 5000ms default)
2. Spawn `qmd update` to re-index changed files
3. Poll MCP `status` tool for `needsEmbedding` count
4. If pending > 0, spawn `qmd embed` to generate embeddings
5. Poll until `needsEmbedding` reaches 0
6. Coalesce multiple update requests during indexing

**Onboarding Flow** (prerequisite-checker.ts, onboarding-modals.ts):
1. On plugin load, check if QMD binary exists and MCP connects
2. Run `qmd collection list` to find collections
3. Check if any collection path matches Obsidian vault path
4. Guide user through: binary missing → no collection → pick collection → needs indexing → ready

## File Organization

### Core Module Responsibilities

| File | Purpose | Key Gotchas |
|------|---------|-------------|
| `main.ts` | Plugin entry point, orchestrates all components | MCP connection is async, don't block plugin load (line 90) |
| `mcp-client.ts` | MCP transport, wraps QMD MCP server tools | Uses stdio transport, process priority on Unix only |
| `indexer.ts` | CLI process spawner for update/embed | Coalesces update requests, polls MCP for embedding status |
| `view.ts` | Search UI, manages lex/hybrid query lifecycle | Debounce lex, trigger hybrid on Enter, abort in-flight queries |
| `resolve-binary.ts` | Cross-platform binary resolution | **Critical for Electron/Flatpak** — see Binary Resolution section |
| `prerequisite-checker.ts` | Startup checks for QMD binary and collections | Parses CLI output, matches vault path |
| `onboarding-modals.ts` | Guided setup modals | Only called when prerequisites fail |
| `settings.ts` | Settings UI | Uses Obsidian Settings API |
| `status-bar.ts` | Bottom-right status indicator | Shows indexing state, daemon status, errors |
| `types.ts` | Shared TypeScript types | `IndexerState`, `QmdSettings`, `QmdSearchResult` |
| `view-utils.ts` | Search result rendering helpers | Path extraction, snippet cleaning, markdown parsing |

### Test Files

All test files follow pattern `*.test.ts` alongside source files. Tests use **vitest** with mocks for `child_process`, Obsidian API, and MCP client. See `src/indexer.test.ts` for mock patterns.

## Code Conventions

### Style Rules (enforced by ESLint)

```javascript
// eslint.config.mjs
- Indentation: tabs (not spaces)
- Quotes: double quotes (template literals always allowed)
- Semicolons: required
- Unused vars: prefix with underscore (_unused)
- Explicit any: warn (prefer unknown or proper types)
```

### TypeScript Setup

- **Target**: ES2018 (matches Obsidian runtime)
- **Module**: ESNext (esbuild bundles to CommonJS)
- **Strict mode enabled**: `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, etc.
- **Base URL**: `src` (import paths relative to src/)
- **Obsidian types**: Uses `obsidian` package for API types

### Build System

**esbuild** (esbuild.config.mjs):
- Entry: `src/main.ts`
- Output: `main.js` (CommonJS)
- Obsidian, Electron, CodeMirror are external (not bundled)
- Development: inline sourcemaps + watch mode
- Production: minified, tree-shaken, no sourcemaps

## Critical Gotchas

### Binary Resolution (resolve-binary.ts)

**Problem**: Electron (especially Flatpak) strips shell PATH. Bare command names like `qmd` won't be found by Node's `spawn()`.

**Solution**: Multi-stage resolution strategy:
1. If absolute path, check if it's a version manager shim (asdf/mise) → resolve to real binary
2. Try platform-specific shell resolution (Unix: `/bin/zsh -l -c "which qmd"`, Windows: `where qmd`)
3. Check well-known paths (`/opt/homebrew/bin`, `~/.local/bin`, etc.)
4. Fall back to bare name

**Why complex?**: Version managers (asdf, mise, nvm) install tools as shims that need the manager on PATH. Since Electron doesn't have shell PATH, we resolve shims to real binaries by scanning `~/.asdf/installs/` and `~/.local/share/mise/installs/`.

**Why shell with `-l -c`?**: `-l` sources login shell config (`.zprofile`, `.bash_profile`), `-li` adds interactive config (`.zshrc`, `.bashrc`) for tools configured there.

**Flatpak-specific**: Strip `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` from spawned process env so QMD uses host directories, not sandbox overrides (line 211-214).

### Process Priority (`niceLevel`)

Unix-only: `setPriority()` deprioritizes indexing/embedding processes to avoid blocking Obsidian UI. Wrapped in try/catch because it fails on Windows. Default `niceLevel: 10` (lower priority).

### MCP Connection Management

- **Async load**: MCP connects in background (don't block plugin load) — see `main.ts:90`
- **Reconnection**: Auto-restart on connection close (max 3 attempts) — see `main.ts:253`
- **Prerequisite check runs after connection** — see `main.ts:159`

### Search Query Lifecycle

**Implicit contract in view.ts**:
1. User types → debounced `searchLex` (keyword only)
2. User hits Enter → `searchHybrid` (keyword + semantic + LLM reranking)
3. Both queries abort on new input
4. `lastFiredLexQuery` tracks last lex query to avoid duplicate Enter handling

**Why separate lex/hybrid?**: Hybrid search is slower (LLM reranking). Show instant keyword results, upgrade to semantic on explicit Enter.

### Indexer State Machine

**State transitions** (indexer.ts):
```
idle ──(requestUpdate)─→ updating ──(success)─→ checking pending
                            │                        │
                            │                     (pending > 0)
                            │                        │
                            └────(fail)───→ error   embedding ──→ idle
                                                      │
                                                   (pending = 0)
```

**Coalescing**: If `requestUpdate()` called while `updating` or `embedding`, set `updateRequested = true` to run again after current pipeline finishes (line 43).

**Cancellation**: `cancel()` kills child process and resets state. Checked at each async boundary (`if (this.cancelled) return`).

### Path Matching (prerequisite-checker.ts)

**Problem**: Obsidian vault path may differ from QMD collection path by:
- Symlinks
- Case sensitivity (macOS/Windows)
- Trailing slashes
- Relative vs absolute

**Solution**: `pathsMatch()` normalizes both paths (resolve, lowercase, trim slashes) before comparing. `pathsOverlap()` checks parent/subfolder relationships for "related" collections.

### Cross-Platform Spawning

Always use spawned processes, never shell strings:
```typescript
// Good
spawn(resolvedPath, ["update"], { env: buildQmdEnv(resolvedPath) })

// Bad (doesn't work on Windows)
spawn("sh", ["-c", `${qmdPath} update`])
```

Use `buildQmdEnv()` to prepend binary directory to PATH and strip Flatpak XDG overrides.

### Obsidian API Patterns

**Vault path extraction** (non-public API):
```typescript
const vaultPath = (this.app.vault.adapter as any).basePath as string;
```

**Settings tab opening** (non-public API):
```typescript
(this.app as any).setting.open();
(this.app as any).setting.openTabById(this.manifest.id);
```

**View registration**: Must call `registerView()` in `onload()`, create leaf in `activateView()`, not in `onload()` (race condition with workspace layout).

## Testing Approach

### Test Philosophy

- **Unit tests with mocks**: Mock `child_process` for indexer, mock Obsidian API for views
- **No integration tests**: Plugin testing requires Obsidian runtime
- **Coverage targets**: Core logic (indexer state machine, prerequisite checker, binary resolution)
- **Not covered**: Obsidian UI interactions, settings tab, modals

### Mock Patterns

**child_process mock** (indexer.test.ts):
```typescript
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}));

const mockProcess = new EventEmitter();
mockProcess.stdout = new EventEmitter();
mockProcess.stderr = new EventEmitter();
mockProcess.kill = vi.fn();
spawn.mockReturnValue(mockProcess);
```

**MCP client mock**:
```typescript
const mockMcpClient = {
	checkPending: vi.fn(async () => 0),
} as unknown as QmdMcpClient;
```

**Trigger mock events**:
```typescript
mockProcess.emit("exit", 0); // Success
mockProcess.stdout.emit("data", Buffer.from("output"));
mockProcess.emit("error", new Error("spawn failed"));
```

## Development Workflow

### Making Changes

1. Read relevant source files
2. Check memory files for conventions
3. Make changes
4. Run `npm test` to verify tests pass
5. Run `npm run build` to verify types and produce bundle
6. **Only then** ask user to test in Obsidian
7. After user confirms, commit immediately

### Adding Features

**Search feature** → modify `view.ts` (UI + query logic) + `view-utils.ts` (rendering)
**Indexing feature** → modify `indexer.ts` (CLI spawning) or `mcp-client.ts` (MCP tools)
**Settings** → modify `types.ts` (add setting) + `settings.ts` (UI) + consuming code
**Binary resolution** → modify `resolve-binary.ts` (platform-specific paths)
**Onboarding** → modify `prerequisite-checker.ts` (checks) + `onboarding-modals.ts` (UI)

### Debugging Tips

**MCP connection fails**: Check `resolve-binary.ts` logs in Obsidian DevTools console. Look for shim resolution failures.

**Indexer stuck**: Check `indexer.ts` state transitions. Add console logs at state changes. Verify `qmd update`/`qmd embed` CLI output.

**Search results wrong**: Check `view.ts` query abort logic. Verify `matchType` tracking. Look at MCP tool call logs.

**Cross-platform issues**: Test on all platforms. Check Windows path separators, Unix-only APIs (`setPriority`), Flatpak XDG overrides.

## Common Pitfall Examples

### ❌ Don't: Run dev command for user testing
```bash
npm run dev  # Doesn't typecheck, may ship broken code
```

### ✅ Do: Run build command
```bash
npm run build  # Typechecks + builds for Obsidian
```

---

### ❌ Don't: Use bare spawn
```typescript
spawn("qmd", ["update"])  // Fails in Electron (no PATH)
```

### ✅ Do: Use resolve-binary
```typescript
const resolvedPath = resolveBinaryPath(this.settings.qmdBinaryPath);
const env = buildQmdEnv(resolvedPath);
spawn(resolvedPath, ["update"], { env });
```

---

### ❌ Don't: Block plugin load
```typescript
async onload() {
	await this.connectMcp();  // User waits for MCP
	this.registerView();      // Plugin load hangs
}
```

### ✅ Do: Connect in background
```typescript
async onload() {
	this.registerView();
	this.connectMcp();  // Don't await
}
```

---

### ❌ Don't: Write to ~/.claude/projects/
```bash
echo "..." > ~/.claude/projects/feedback.md
```

### ✅ Do: Write to repo memory/
```bash
echo "..." > memory/feedback_feature_name.md
```

---

### ❌ Don't: Assume PATH works
```typescript
execSync("which qmd")  // Fails in Flatpak
```

### ✅ Do: Use shell explicitly
```typescript
execFileSync("/bin/zsh", ["-l", "-c", "which qmd"])
```

## Relevant Documentation

- **QMD**: https://github.com/tobi/qmd
- **QMD MCP Server**: https://github.com/tobi/qmd?tab=readme-ov-file#mcp-server
- **Obsidian Plugin API**: https://github.com/obsidianmd/obsidian-api
- **MCP SDK**: https://github.com/modelcontextprotocol/typescript-sdk
- **esbuild**: https://esbuild.github.io/

## Project Status

- **Version**: 1.0.0-beta
- **License**: GPL-3.0-only
- **Node**: 22.x (CI target)
- **TypeScript**: 5.8.x
- **Obsidian API**: latest

### Known Limitations

- QMD MCP server is read-only → plugin uses CLI for indexing (tracked in [tobi/qmd#587](https://github.com/tobi/qmd/issues/587))
- No integration tests (requires Obsidian runtime)
- Binary resolution heuristics may fail for exotic setups (edge case: custom install paths)

### Future Roadmap

- **QMD contexts** — upcoming QMD feature for contextual understanding
- Simplify to single MCP interface when index management tools are available
