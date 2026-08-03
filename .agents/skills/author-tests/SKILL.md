---
name: author-tests
description: Create or update focused automated tests and fixtures for an immutable construction checkpoint, run configured verification commands, and report production defects without editing production code. Use in parallel with the security review after construction.
---

# Author Tests

Read [contract.md](references/contract.md). Validate and enter the delegated worktree, then inspect the approved plan, acceptance criteria, construction revision, existing test conventions, and `.agent-factory/project.md`.

Add or update only tests and fixtures. Cover observable behavior, regressions, boundaries, failures, and acceptance criteria at the narrowest useful seams. Do not weaken assertions merely to make tests pass.

If a test exposes a production defect, preserve the useful failing evidence and report it to the parent; never patch production code. Run focused tests and every configured required command. Create a tests-only checkpoint commit when files change.

Do not spawn agents, publish changes, or waive failures. Return the required stage result.
