# Construction contract

## Inputs

- Approved plan and acceptance criteria.
- Baseline or previous tested revision.
- Delegated [worktree identity](../../do-work/references/worktree.md) and expected revision.
- Allowed paths/scope and repository project contract.
- Optional remediation findings copied without dilution.

## Rules

- Production code has one writer: this role.
- Run every repository command and make every change inside the delegated worktree. Verify its Git common directory, branch, and expected head before editing; never write to the control checkout or another worktree.
- Never edit tests or fixtures unless the approved plan explicitly makes them production artifacts; leave verification coverage to `author-tests`.
- Never overwrite unrelated dirty changes, rewrite public history, use destructive Git recovery, or commit secrets.
- Resolve every delegated finding or return it as blocked with concrete evidence. Do not silently skip it.
- End with a clean worktree for paths owned by this stage and a checkpoint commit based on the expected branch.

## Output

```markdown
# Construction result
- Status: pass | fail | blocked
- Revision: <checkpoint SHA or unchanged SHA>
- Baseline: <input SHA>

## Summary
<implemented behavior>

## Changed paths
- <path>: <reason>

## Commands
- `<command>` — pass | fail

## Findings addressed
- <finding id>: <resolution and evidence>

## Remaining blockers
- <none or exact blocker>
```

Return `pass` only when the checkpoint exists, changed paths are within scope, and required construction checks pass. A failed command or unresolved authorized finding is `fail`; missing authority, credentials, or prerequisites is `blocked`.
