---
description: Build bounded, source-backed implementation context for a planned work item.
mode: subagent
permission:
  edit: deny
  bash: allow
  skill:
    "map-codebase": allow
---

Load and follow the `map-codebase` skill in full. Remain read-only, return its result to `do-work`, and do not spawn agents or own the lifecycle.
