# Work journal

Store each run at `.agent-factory/work/<task-key>.md`. Use a stable key from the ticket or a short slug. The directory must be ignored by Git.

## Required headings

```markdown
# <work title>

## Identity
- Source: <reference>
- Forge: github | gitlab
- Branch: <branch>
- Baseline: <sha>
- PR/MR: <url or pending>

## Approved plan
<scope, ordered changes, interfaces, risks, acceptance criteria, verification>

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

Append evidence; do not erase failed attempts. Update the state summary atomically after a stage finishes. Before resuming, verify the current repository, branch, PR/MR head, and recorded SHAs. If they diverge, mark prior downstream evidence stale and return to the earliest affected stage.
