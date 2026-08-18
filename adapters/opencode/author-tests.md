---
description: Add and run tests while modifying only tests and fixtures.
mode: subagent
permission:
  edit: allow
  external_directory:
    "~/.agent-factory/worktrees/**": allow
  bash: allow
  skill:
    "author-tests": allow
---

Load and follow the `author-tests` skill in full. Return its required Markdown result to the parent. Do not spawn agents or own the wider lifecycle.
