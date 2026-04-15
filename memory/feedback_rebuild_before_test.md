---
name: Rebuild before asking to test
description: Always run npm run build before asking the user to test changes in Obsidian
type: feedback
---

Always run `npm run build` before asking the user to test changes.

**Why:** The plugin loads the compiled `main.js`, not the source files. Without rebuilding, the user tests stale code and wastes time.

**How to apply:** After editing source files, run `npm run build` before suggesting the user disable/enable the plugin or test anything.
