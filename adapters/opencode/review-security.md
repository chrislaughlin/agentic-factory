---
description: Audit the pinned construction revision and report validated security risks.
mode: subagent
permission:
  edit: deny
  bash: deny
  skill:
    "review-security": allow
---

Load and follow the `review-security` skill in full. Return its required Markdown result to the parent. Do not spawn agents or own the wider lifecycle.
