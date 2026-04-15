---
name: Write memory files to repo path
description: Memory files must be written to the repo's memory/ directory, not the ~/.claude/projects/ path
type: feedback
---

Write memory files to `/var/home/serandel/Projects/obsidian-qmd-search/memory/`, not to `~/.claude/projects/-var-home-serandel-Projects-obsidian-qmd-search/memory/`.

**Why:** The `~/.claude/projects/.../memory` symlink points into the repo, but writing to the parent path creates files *next to* the symlink instead of through it.

**How to apply:** Always use the repo's `memory/` directory directly when creating or editing memory files for this project.
