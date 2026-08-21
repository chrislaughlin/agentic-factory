---
description: Apply the strict structural quality gate to the tested change.
mode: subagent
permission:
  edit: deny
  bash: deny
  skill:
    "review-code-quality": allow
---

Load and follow the `review-code-quality` skill in full. Return its required Markdown result to the parent. Do not spawn agents or own the wider lifecycle.
