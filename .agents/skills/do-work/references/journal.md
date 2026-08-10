# Work journal

Store each run at `<absolute-git-common-directory>/agent-factory/work/<task-key>.md`, using the common directory from the [worktree identity](worktree.md). Use a stable key from the ticket or a short slug. Git's private metadata keeps journals local and makes them accessible from every linked worktree without modifying the user's control checkout.

## Required headings

```markdown
# <work title>

## Identity
- Source: <reference>
- Forge: github | gitlab
- Git common directory: <absolute path>
- Control checkout: <absolute path>
- Worktree: <absolute path>
- Branch: <branch>
- Baseline: <sha>
- PR/MR: <url or pending>

## Approved plan
<scope, ordered changes, interfaces, risks, acceptance criteria, verification>

## Repository context
<resolved fields and source evidence required by [repository-discovery.md](repository-discovery.md)>

## Environment bootstrap
- <copied relative .env path, or none>

## State
- Stage: planning | construction | parallel-verification | qa | code-quality | publication | monitoring | human-handoff | blocked
- Feedback batch: initial | <remote batch id>
- Attempt: 0 | 1 | 2 | 3
- Construction revision: <sha or pending>
- Tested revision: <sha or pending>
- Security revision: <sha or pending>

## Evidence
<timestamped stage summaries and commands>

## Findings
<open, cleared, informational; include stable identifiers where available>

## Monitoring
- Last observation: <timestamp>
- CI state: pending | pass | fail
- Review cursor: <forge-specific cursor>
- Poll deadline: <timestamp>

## Resume
Use $do-work <original-reference-or-pr-url> and validate branch/revisions before continuing.
```

Append evidence; do not erase failed attempts. Update the state summary atomically after a stage finishes. Never store environment-file contents or values. Before resuming, verify the Git common directory, control checkout, registered worktree path, branch, PR/MR head, recorded SHAs, environment-bootstrap paths, and repository-context sources. If a human removed the worktree, recreate it from the validated recorded branch and bootstrap only from the recorded control checkout. If state diverges, refresh the affected context, mark prior downstream evidence stale, and return to the earliest affected stage.
