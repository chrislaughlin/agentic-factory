---
name: author-tests
description: Independently create or update focused automated tests and fixtures for a high-assurance construction checkpoint, run configured verification commands, and report production defects without editing production code.
---

# Author Tests

Read [contract.md](references/contract.md). Validate and enter the delegated worktree, then inspect the approved plan, acceptance criteria, construction revision, existing test conventions, and repository context supplied by the parent orchestrator.

Add or update only tests and fixtures. Cover observable behavior, regressions, boundaries, failures, and acceptance criteria at the narrowest useful seams. Do not weaken assertions merely to make tests pass.

This separate test-authoring role is for the approved high-assurance lane. Light and standard work keep focused tests with `construct-work` to avoid late dependency and fixture discovery.

If a test exposes a production defect, preserve the useful failing evidence and report it to the parent; never patch production code. Run focused tests and every discovered required command. Create a tests-only checkpoint commit when files change.

Do not spawn agents, publish changes, or waive failures. Return the required stage result.
