# End-to-end release evidence

## Automated live path

`test/hardening.test.ts` loads the checked-in workflow, canonical agents, and skills; creates a real Git repository, isolated worktree, and bare origin; then executes a real NDJSON subprocess harness through:

1. request submission and read-only planning;
2. durable plan approval pause;
3. construction commits and a remediation commit made by the subprocess in the worktree, followed by test authoring and five deterministic command gates;
4. concurrent security, QA, and code review on one revision;
5. an intentional blocking review finding, typed remediation, a new revision, and stale-evidence invalidation;
6. a real revision-checked Git push plus idempotent PR publication and CI/review evidence ingestion through provider contracts;
7. revision-bound final approval and expected-head merge;
8. deployment observation and revision-bound smoke verification;
9. terminal `completed` state.

Companion integration tests restart SQLite between GitHub polls and deployment observation, replay duplicate external events, reject stale approval, roll back deployment failure, terminate command timeout, exhaust recurring-finding retries, and verify worktree locks/cleanup. The full suite is the committed reproducible evidence. GitHub and deployment APIs use contract providers so tests remain deterministic and credential-free; release PRs exercise the real GitHub Actions workflow separately.

## Release verification record

Record the release commit and outputs here when tagging:

```text
Commit: <sha>
Date: <UTC timestamp>
pnpm validate: <pass/fail>
pnpm security: <pass/fail>
Live GitHub/deployment smoke run: <run id and artifact IDs>
Waivers: <none or linked rationale>
```
