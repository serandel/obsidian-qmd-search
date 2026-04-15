---
name: Tests with every commit
description: Write tests for changed behavior and run npm test before every commit
type: feedback
---

Include automated tests for changed behavior in the same commit, and always run `npm test` before committing.

**Why:** User expects tests and code to stay in sync per CLAUDE.md. Tests in a separate commit can drift or be forgotten.

**How to apply:** When editing source files, write or update tests for the changed behavior and include them in the same commit. Run `npm test` before `git commit` to verify everything passes.
