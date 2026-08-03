# GitLab workflow

Use authenticated GitLab tools when available; otherwise use `glab`. Prefer JSON/API output over scraping terminal tables.

## Resolve and publish

- Resolve issue URLs, project issue identifiers, and existing MR URLs without asking for accessible content.
- Confirm the project, default branch, current branch, and authenticated account before mutation.
- Push the task branch, then create a non-draft MR with `glab mr create` or an equivalent native tool.
- Link the source issue and include local quality evidence in the description.

## Monitor

- Poll the MR head SHA, required pipeline jobs, approval/review state, discussions, and new notes.
- Use the configured interval and timeout; default to 60 seconds and 60 minutes.
- A failed required pipeline/job becomes a CI feedback batch. Capture its name, URL, status, and concise failing evidence.
- Treat explicit requested changes and unresolved actionable discussions as review feedback. Ignore already addressed or superseded notes.
- Resolve a discussion only after the requested change is pushed and fully revalidated.
- On timeout, persist pipeline states, discussion cursor, head SHA, and exact `$do-work <mr-url>` resume instruction.

Never merge, enable merge-when-pipeline-succeeds, change protections/approvals, resolve objections without a fix, or expose credentials.
