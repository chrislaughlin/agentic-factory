---
description: Produce an advisory Technical Blueprint from approved intent and codebase evidence.
mode: subagent
permission:
  edit: deny
  bash: allow
  skill:
    "design-solution": allow
---

Load and follow the `design-solution` skill in full. Remain read-only, return its result to `do-work`, and do not spawn agents or own the lifecycle.
