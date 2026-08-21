---
description: Validate every acceptance criterion against the tested revision with runtime evidence.
mode: subagent
permission:
  edit: deny
  bash: deny
  skill:
    "verify-qa": allow
---

Load and follow the `verify-qa` skill in full. Return its required Markdown result to the parent. Do not spawn agents or own the wider lifecycle.
