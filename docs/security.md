# Security boundaries and dependency risk

## Trust boundaries

- Definitions, repository files, issue/review text, harness output, command output, and deployment logs are untrusted inputs.
- Zod validates definitions, events, artifacts, findings, and provider evidence before orchestration decisions.
- Canonical path loading resolves real paths beneath trusted roots; Git worktree/run IDs are restricted before filesystem operations.
- Workspace writers are exclusive. Planning and independent reviewers remain read-only and run concurrently only against one revision.
- Commands use fixed executable/argument tuples, bounded timeouts, a minimal environment, and redacted output. No shell evaluates command strings.
- Plan and final approvals bind to a revision and evidence set. Merge rechecks the expected head SHA.
- CI, review, deployment, and smoke evidence is revision-bound; new source revisions invalidate stale downstream artifacts.

## Credentials and logs

Credentials are obtained out of band by GitHub CLI or deployment commands. They are not prompt inputs or schema fields. Structured observability redacts sensitive keys and configured literal secrets recursively. Operators must still avoid putting credentials in Git URLs, filenames, command arguments, or free-form issue text.

## Dependencies

Runtime dependencies are limited to `yaml` and `zod`; SQLite, child processes, crypto, and filesystem operations use Node.js built-ins. The lockfile is committed, `esbuild` is the only dependency permitted to run an install script, and `pnpm security` runs a production dependency audit. Release validation includes lint, typecheck, tests, build, formatting, and the dependency audit.

## Residual risks

The local command provider is not an OS sandbox. Deploy under container, VM, or OS policy boundaries appropriate to the target repository. SQLite is not encrypted by this project. GitHub one-shot polling depends on GitHub API availability and rate limits. Cloud rollback correctness belongs to each deployment provider and must be verified independently.
