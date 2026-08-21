---
description: Monitor CI and review feedback on the published PR or MR.
mode: subagent
permission:
  edit: deny
  bash: deny
  skill:
    "watch-change": allow
---

Load and follow the `watch-change` skill in full. Return its required Markdown result to the parent. Do not spawn agents or own the wider lifecycle.
