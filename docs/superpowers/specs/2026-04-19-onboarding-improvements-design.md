# Onboarding Improvements Design

## Context

New users of the obsidian-qmd-search plugin face a steep onboarding curve. Three
prerequisites must be met before the plugin works — QMD installed, a collection
created pointing to the vault, and embeddings generated — but the plugin provides
only generic error messages when any of these are missing. Users must consult the
README and run CLI commands manually with no in-plugin guidance.

This design adds a **prerequisite check pipeline** that detects the exact missing
state and presents **modal dialogs with action buttons** so users can resolve each
issue without leaving Obsidian.

## Design

### Prerequisite Checker (`prerequisite-checker.ts`)

A new module that determines the plugin's readiness state. Returns one of:

```typescript
type PrerequisiteResult =
  | { status: "ready"; collection: string }
  | { status: "binary-missing" }
  | { status: "no-collection"; candidates: CollectionInfo[] }
  | { status: "pick-collection"; candidates: CollectionInfo[] }
  | { status: "needs-indexing"; collection: string };

type CollectionInfo = {
  name: string;
  path: string;
};
```

**Check sequence (runs after MCP connection attempt):**

1. **Binary check** — If `connectMcp()` threw a spawn error, return `binary-missing`.
2. **Collection detection** — Run `qmd collection list` via CLI, parse output to
   extract collection names. For each, run `qmd collection show <name>` to get its
   path. Compare paths against `this.app.vault.adapter.basePath`.
   - **Single match:** Return `ready` (or `needs-indexing` if warmup fails)
     with the matched collection name.
   - **Multiple matches:** Return `pick-collection` with all matches as
     `candidates` so the modal can present a picker.
   - **No match:** Return `no-collection` with empty `candidates`.
3. **Indexing check** — If a collection is matched, the existing warmup query
   serves as a health check. A failure here means `needs-indexing`.

**CLI output parsing:**

The `qmd collection list` output format:
```
Collections (N):

name1 (qmd://name1/)
  Pattern:  **/*.md
  Files:    5465
  Updated:  20h ago

name2 (qmd://name2/)
  ...
```

Parse collection names from lines matching `^(\S+) \(qmd://`. Then run
`qmd collection show <name>` to get the path from the `Path:` line.

### Modal Dialogs

Three modal types, each an Obsidian `Modal` subclass:

#### a) QMD Not Found Modal

- **Title:** "QMD is not installed"
- **Body:** "QMD is a fast local search engine for Markdown files. This plugin
  needs it to work."
- **Actions:**
  - **"Open QMD download page"** — opens `https://github.com/tobi/qmd` in default
    browser via `window.open()`
  - **"I've set a custom path"** — opens plugin settings tab
  - **"Dismiss"** — closes modal

#### b) No Collection Modal

- **Title:** "No QMD collection found for this vault"
- **Body:** Shows the detected vault path. Explains that QMD needs a collection
  pointing to this folder.
- **If candidates exist (multiple matching collections):**
  - Dropdown/list to pick one. Selection saves to `settings.collection` and
    proceeds to warmup.
- **If no candidates:**
  - **"Create collection"** button — runs
    `qmd collection add <vault-path> --name <suggested-name>`. Suggested name is
    derived from the vault folder name (lowercased, spaces → hyphens).
  - Shows a text input for the collection name (pre-filled with suggestion, editable).
  - On success: saves collection name to `settings.collection`, shows the
    "Ready to Index" modal.
  - On error: shows the error inline in the modal.
- **"Use existing collection"** — if other non-matching collections exist, allow
  picking one (the user may know their setup better than path matching).
- **"Dismiss"** — closes modal.

#### c) Ready to Index Modal

Shown after successful collection creation.

- **Title:** "Collection created! Ready to index"
- **Body:** "Initial indexing and embedding generation may take a few minutes
  depending on vault size."
- **Actions:**
  - **"Start indexing now"** — triggers `indexer.requestUpdate()`, closes modal
  - **"I'll do it later"** — closes modal

### Collection Selection Persistence

When a user selects or creates a collection (via modal or settings), the choice is
always saved to `settings.collection` via `plugin.saveSettings()`. The existing
collection setting in the settings tab remains fully editable, so users can change
their choice at any time.

### Startup Flow Changes

Modified `onload()` sequence in `main.ts`:

```
loadSettings()
→ setup UI (status bar, views, commands, file watcher, settings tab)
→ connectMcp()
  → SUCCESS:
    → runPrerequisiteCheck()
      → "ready": proceed normally (warmup, auto-index)
      → "pick-collection": show collection picker modal
      → "no-collection": show No Collection modal (with create option)
      → "needs-indexing": show Ready to Index modal
  → FAILURE:
    → show QMD Not Found modal
    → status bar shows "QMD ✗"
```

The prerequisite check is **non-blocking** — the plugin loads fully and registers
all views/commands. Modals appear asynchronously. If dismissed, the status bar
reflects the degraded state.

### Re-check Triggers

Since this is contextual (not one-time), prerequisite checks also run when:

- User clicks the "QMD ✗" status bar indicator
- User changes the binary path or collection name in settings and saves
- `ensureConnection()` reconnects after a crash

### Files to Create/Modify

- **Create:** `src/prerequisite-checker.ts` — detection logic, CLI parsing
- **Create:** `src/onboarding-modals.ts` — three modal classes
- **Modify:** `src/main.ts` — integrate prerequisite check into startup flow,
  add re-check triggers
- **Modify:** `src/settings.ts` — trigger re-check on setting changes
- **Modify:** `README.md` — simplify prerequisites, mention guided setup
- **Create:** `tests/prerequisite-checker.test.ts` — unit tests for checker
- **Create:** `tests/onboarding-modals.test.ts` — unit tests for modals

### Testing

- **Prerequisite checker tests:**
  - Mock `spawn` to simulate different `qmd collection list` outputs (0, 1,
    multiple collections)
  - Test path matching against vault path (exact match, no match, multiple matches)
  - Test parsing of various CLI output formats
  - Test binary-missing detection from spawn errors

- **Modal tests:**
  - Verify correct modal type is shown for each prerequisite result
  - Test collection creation flow (button click → spawn → settings update)
  - Test collection picker saves to settings
  - Test "Start indexing" button triggers indexer

- **Integration verification:**
  - Uninstall/hide qmd from PATH → plugin should show "QMD Not Found" modal
  - Have qmd but no collection → should show "No Collection" modal with create button
  - Create collection via modal → should show "Ready to Index" modal
  - Have working setup → should proceed normally with no modals

### README Updates

The Prerequisites section currently lists three manual steps. Since the plugin now
handles collection creation and indexing, update it to:

- **Prerequisites:** Only QMD needs to be installed. The plugin will guide the user
  through collection creation and indexing on first use.
- Remove the manual `qmd collection add` and `qmd embed` instructions.
- Mention that the plugin auto-detects collections matching the vault path and
  offers to create one if none exists.

**File to modify:** `README.md` (Prerequisites section)

### Out of Scope

- Changes to the search view itself (Approach C was rejected)
- One-time wizard (contextual approach was chosen)
- JSON output from `qmd collection list` (parsing text output is sufficient)
- QMD installation automation (we link to the download page, not install for them)
