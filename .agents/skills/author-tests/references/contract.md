# Test authoring contract

## Inputs

- Approved plan and acceptance criteria.
- Construction checkpoint SHA and expected branch.
- Project test commands and repository conventions.

## Rules

- Modify only test files, fixtures, snapshots, and test-only helpers recognized by the repository.
- Do not change production sources, dependency manifests, build configuration, or CI configuration.
- Test externally meaningful behavior. Avoid tests that only mirror implementation details.
- Run focused tests while iterating, then the configured full tests and required deterministic checks.
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
