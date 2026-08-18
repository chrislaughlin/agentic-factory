# Construction contract

## Inputs

- Approved plan and acceptance criteria.
- Baseline or previous tested revision.
- Delegated [worktree identity](../../do-work/references/worktree.md) and expected revision.
- Allowed paths/scope and relevant discovered repository context.
- Optional remediation findings copied without dilution.

## Rules

- Production code has one writer: this role.
- Run every repository command and make every change inside the delegated worktree. Verify its Git common directory, branch, and expected head before editing; never write to the control checkout or another worktree.
- Before reading implementation code, verify the registered common directory, task branch, and HEAD using `git -C <worktree>`; verify it differs from the control checkout; create and immediately remove a harmless unique probe file inside the worktree; and confirm it is absent from Git status. On any failure, clean up and return `blocked` with the path/permission error before analysis. Never stage the probe or fall back to another checkout.
- Never edit tests or fixtures unless the approved plan explicitly makes them production artifacts; leave verification coverage to `author-tests`.
- Never overwrite unrelated dirty changes, rewrite public history, use destructive Git recovery, or commit secrets.
- Resolve every delegated finding or return it as blocked with concrete evidence. Do not silently skip it.
- Revalidate every journaled environment-file path according to the worktree identity contract immediately before staging or committing. Never stage one of those paths, even forcibly.
- End with a clean worktree for paths owned by this stage and a checkpoint commit based on the expected branch.

## Output

```markdown
# Construction result
- Status: pass | fail | blocked
- Revision: <checkpoint SHA>
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

Return `pass` only when a new non-empty checkpoint exists, changed paths are within scope, and required construction checks pass. An unchanged revision is never successful initial construction unless the parent explicitly delegated an approved no-op. A failed command or unresolved authorized finding is `fail`; missing authority, credentials, or prerequisites is `blocked`.
