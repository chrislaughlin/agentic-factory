# Test authoring contract

## Inputs

- Approved plan and acceptance criteria.
- Construction checkpoint SHA and expected branch.
- Delegated [worktree identity](../../do-work/references/worktree.md), with the construction checkpoint supplied separately as the expected revision.
- Project test commands and repository conventions.

## Rules

- Modify only test files, fixtures, snapshots, and test-only helpers recognized by the repository.
- Run every repository command and make every test change inside the delegated worktree. Verify its Git common directory, branch, and construction head before editing; never write to the control checkout or another worktree.
- Do not change production sources, dependency manifests, build configuration, or CI configuration.
- Test externally meaningful behavior. Avoid tests that only mirror implementation details.
- Run focused tests while iterating, then the configured full tests and required deterministic checks.
- Revalidate every journaled environment-file path according to the worktree identity contract immediately before staging or committing. Never stage one of those paths, even forcibly.
- Commit changed test assets separately. If no change is needed, return the unchanged head and explain existing coverage.

## Output

```markdown
# Test result
- Status: pass | fail | blocked
- Construction revision: <input SHA>
- Tested revision: <tests checkpoint SHA or unchanged SHA>

## Coverage added or confirmed
- <criterion/behavior>: <test location>

## Changed paths
- <test or fixture path>: <reason>

## Commands
- `<command>` — pass | fail with concise evidence

## Production defects
- <stable id, reproduction, expected, actual, evidence>

## Blockers
- <none or exact blocker>
```

Return `pass` only when required commands pass and no production defect remains. Missing runtime/services or unsafe dirty-state conflicts are `blocked`.
