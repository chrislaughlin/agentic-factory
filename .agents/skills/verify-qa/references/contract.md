# QA contract

Inputs include the delegated [worktree identity](../../do-work/references/worktree.md) and the tested revision as the separate expected revision. Validate both before launching the runtime or collecting evidence.

## Evidence rules

- Map every approved acceptance criterion to an explicit result.
- Use the discovered repository context's launch path, fixtures, safe test data, and required evidence.
- For UI behavior, interact with the running interface and capture visible state plus relevant console/network evidence.
- For APIs and CLIs, capture sanitized requests/commands, responses/output, exit status, and resulting state.
- For libraries, execute a consumer-visible example or targeted integration path when meaningful.
- Exercise permission failures, validation errors, empty states, and regressions named by the plan.
- Never record secrets or claim a pass because a unit test exists.

```markdown
# QA result
- Status: pass | fail | blocked
- Tested revision: <SHA>

## Acceptance criteria
- [AC-<id>] pass | fail | blocked
  - Method: <runtime or justified static method>
  - Evidence: <observable result>

## Regression observations
- <result>

## Commands and runtime actions
- <action> — <outcome>

## Findings
- [QA-<stable id>] <expected, actual, reproduction, evidence>

## Blockers
- <none or missing service/access/prerequisite>
```

Return `pass` only when every criterion passes. A behavioral mismatch is `fail`. Missing required runtime access, data, credentials, or environment is `blocked`, never a waiver.
