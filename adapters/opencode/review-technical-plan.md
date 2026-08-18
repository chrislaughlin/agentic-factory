---
description: Adversarially review a risky or complex Technical Blueprint before approval.
mode: subagent
permission:
  edit: deny
  bash: allow
  skill:
    "review-technical-plan": allow
---

Load and follow the `review-technical-plan` skill in full. Remain read-only, return its result to `do-work`, and do not spawn agents or own the lifecycle.
