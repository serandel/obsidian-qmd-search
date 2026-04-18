---
name: Cross-platform solutions
description: All solutions must target Windows, macOS, and Linux from the start
type: feedback
---

Always ensure solutions work on Windows, macOS, and Linux. Don't write platform-specific code that only works on the current dev machine — consider all three platforms from the start.

**Why:** This is an Obsidian plugin that runs on all desktop platforms. Platform-specific code (like scanning `/proc`) needs equivalent implementations for the other platforms.

**How to apply:** When writing code that touches the OS (process management, file paths, shell commands), implement and verify all three platform paths in the same PR. Don't defer other platforms to later.
