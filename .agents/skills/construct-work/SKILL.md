---
name: construct-work
description: Implement an explicitly approved software plan or a bounded remediation request as the sole production-code writer. Use after do-work delegates construction with fixed scope, acceptance criteria, baseline revision, and checkpoint requirements.
---

# Construct Work

Read [contract.md](references/contract.md). Before implementation reasoning, validate and enter the delegated worktree and complete its cheap identity/write preflight. If it fails, clean the probe and return `blocked` immediately; never fall back to the current/control checkout.

Implement only the approved plan or supplied remediation findings. If implementation exposes a missing material product, UX, scope, architecture, contract, authority, or risk decision, stop and return it to `do-work`; do not invent it. Do not change scope, weaken acceptance criteria, waive findings, publish a PR/MR, or spawn agents. Ask the parent orchestrator when authority or requirements are missing.

Keep unrelated changes intact. Prefer direct, repository-native designs and reuse canonical abstractions. Run focused checks during work and all construction-required checks before handoff.

Inspect the final diff for scope and accidental changes. Create a checkpoint commit containing the production changes and any directly required documentation, but no test changes delegated to `author-tests`.

Return the required stage result.
