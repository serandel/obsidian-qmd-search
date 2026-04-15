---
name: Commit after completing changes
description: Always commit immediately after completing a code change — don't wait for user to ask or confirm
type: feedback
---

When the user confirms a change is good, commit it immediately. "Good", "looks good", "works", etc. means "commit this", not "we're done".

**Why:** The user has had to remind me to commit multiple times across sessions. Waiting for confirmation is fine, but once confirmed, commit without being asked.

**How to apply:** After a code change, wait for user confirmation. When they confirm (e.g. "good"), proceed straight to commit. Don't reply with "let me know if you need anything else" — that's the wrong response to a confirmation.
