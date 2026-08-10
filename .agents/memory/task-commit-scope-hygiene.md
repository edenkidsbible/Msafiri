---
name: Task commit scope hygiene
description: How to handle unrelated dirty working-tree changes swept into a task's completion commit/review.
---

Completion validation auto-commits the entire dirty working tree and reviews the full base..HEAD diff — unrelated in-progress work in the tree gets attributed to your task and can fail review.

**Why:** A small rename task was rejected repeatedly because an unrelated (and insecure) feature existed as uncommitted files; the auto-commit swept it in, and even after local resets the machinery rebased the branch onto the parent branch that had received the swept-in commit.

**How to apply:**
- Local `git reset`/cherry-pick onto an older base does NOT work — the branch gets rebased back onto the parent branch before validation.
- The reliable fix is `git revert <unrelated-commit>` on the task branch so the *net* base..HEAD diff contains only the task's changes.
- Preserve the reverted work first: `git format-patch -1 <sha> --stdout > .local/tasks/<name>.patch` (`.local/` is git-ignored) and file a follow-up task pointing to it.
