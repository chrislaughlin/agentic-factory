# GitHub workflow

Use authenticated GitHub tools when available; otherwise use `gh`. Read-only discovery may use `gh issue view`, `gh pr view`, `gh pr checks`, and `gh api`. Use structured JSON output instead of scraping terminal tables.

## Resolve and publish

- Resolve issue URLs or `owner/repo#number` references without asking for content already available.
- Confirm the remote repository, default branch, current branch, and authenticated account before mutation.
- Push the task branch, then create a ready PR with `gh pr create` or an equivalent native tool. Do not use draft mode.
- Link the source issue and include the local quality evidence in the body.

## Monitor

- Poll required checks and check suites, the PR head SHA, review decisions, review threads, and new comments.
- Use the configured interval and timeout; default to 60 seconds and 60 minutes.
- A failed required check becomes a CI feedback batch. Capture its name, URL, conclusion, and concise failing evidence.
- Treat `CHANGES_REQUESTED` and unresolved actionable review threads as requested changes. Do not equate general discussion or approvals with changes.
- Reply or resolve only after the requested change is present in a pushed, fully revalidated revision.
- On timeout, persist the last check states, review cursor, head SHA, and exact `$do-work <pr-url>` resume instruction.

Never merge, enable auto-merge, alter branch protection, dismiss a review, or expose credentials.
