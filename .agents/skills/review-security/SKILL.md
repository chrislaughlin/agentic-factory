---
name: review-security
description: Perform an independent read-only security review of the changed production attack surface at a pinned Git revision. Use after construction to find and evidence every validated security risk without modifying code.
---

# Review Security

Read [rubric.md](references/rubric.md). Validate the delegated worktree, then review the exact construction SHA using commit-addressed Git operations so concurrent test changes cannot alter the target.

Remain read-only. Inspect the plan, diff from baseline, relevant surrounding code, trust boundaries, dependencies, configuration, and repository security guidance. Run safe read-only checks when available.

Report only reproducible or well-evidenced risks as blocking findings. Separate informational hardening ideas and speculative concerns. Do not edit, spawn agents, waive risk, or review a different revision.

Return the required stage result.
