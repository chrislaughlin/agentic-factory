# Compatibility matrix

| Surface             | Version / status           | Support boundary                                                      |
| ------------------- | -------------------------- | --------------------------------------------------------------------- |
| Node.js             | 22, 24                     | Supported; `node:sqlite` required                                     |
| pnpm                | 10, 11                     | Supported with committed lockfile and build allowlist                 |
| Git                 | 2.40+                      | Worktree, ancestry check, push, and expected branch revision          |
| GitHub CLI          | 2.45+                      | PR create/update, checks, reviews, logs, threads, expected-head merge |
| Scripted harness    | v1                         | Deterministic demonstrations and tests                                |
| Process harness     | NDJSON v1                  | Real local process execution, cancellation, timeout, typed events     |
| Codex adapter       | contract only              | Materialization/capability contract; invocation bridge required       |
| Claude Code adapter | contract only              | Materialization/capability contract; invocation bridge required       |
| OpenCode adapter    | contract only              | Materialization/capability contract; invocation bridge required       |
| Persistence         | SQLite v1                  | One operator host; restart-safe transactions and cursors              |
| Deployment          | command provider v1        | Allowlisted deploy/smoke/rollback commands with local durable state   |
| CLI JSON            | `agent-factory.dev/cli/v1` | Versioned machine output and stable exit codes                        |

Provider adapters must not claim support beyond this table. Unsupported harness invocation throws `HARNESS_OPERATION_UNSUPPORTED`.
