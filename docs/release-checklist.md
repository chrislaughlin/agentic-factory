# Initial release checklist

- [ ] `pnpm install --frozen-lockfile` succeeds with only approved build scripts.
- [ ] `pnpm validate` passes from a clean checkout.
- [ ] `pnpm security` reports no high-severity production dependency vulnerabilities.
- [ ] The full process-harness end-to-end test passes with remediation and both human gates.
- [ ] SQLite restart tests pass for workflow state, GitHub cursors/dedupe, and deployment observation.
- [ ] Source changes invalidate local, CI, review, quality-gate, and final-report evidence.
- [ ] Cancellation, timeout, retry exhaustion, rollback, and worktree cleanup tests pass.
- [ ] `agent-factory doctor` accurately reports repository, persistence, harness, GitHub, CI, and deployment readiness.
- [ ] Installation, configuration, operation, extension, recovery, troubleshooting, and security guidance is current.
- [ ] Known limitations and the compatibility matrix are accurate.
- [ ] Release tag and package version match the compatibility matrix.

The release owner records command output, commit SHA, date, and any waived item in `docs/e2e-evidence.md` before tagging.
