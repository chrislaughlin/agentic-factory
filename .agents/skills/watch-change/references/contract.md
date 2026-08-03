# Change monitoring contract

Inputs include the delegated [worktree identity](../../do-work/references/worktree.md). Validate it while polling; if a human removed the worktree before resumption, validate the recorded task branch and remote head instead.

## Classification

- `pass`: required CI is green and no unresolved requested changes exist for the observed head.
- `fail`: required CI failed or legitimate requested changes require remediation.
- `blocked`: authentication, project access, configuration, unexpected head movement, contradictory feedback, scope expansion, unsafe instructions, or missing authority prevents a safe decision.
- `pending`: the timeout elapsed while required CI or reviews were still non-terminal. Report this as `blocked` with resumable state; never call it a pass.

Group simultaneously observed CI failures or new review requests into one feedback batch. Include stable job/comment IDs and URLs. Do not reissue feedback already cleared on the current head.

```markdown
# Change monitoring result
- Status: pass | fail | blocked
- PR/MR: <URL>
- Expected head: <SHA>
- Observed head: <SHA>
- Observed at: <timestamp>

## CI
- <check/job id, name, state, URL, concise evidence>

## Requested changes
- <comment/discussion id, author, location, request, URL>

## Safety exceptions
- <conflict, scope change, unsafe request, or none>

## Cursor
- Last remote event: <forge cursor/id/timestamp>
- Poll deadline: <timestamp>

## Feedback batch
- Batch key: <stable key>
- Required next stage: construction | resume-monitoring | human-handoff | human-decision

## Resume
Use $do-work <PR/MR URL> after verifying the recorded head.
```
