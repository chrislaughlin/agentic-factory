# Security review contract

Review changed and newly reachable attack surfaces for:

- authentication, authorization, tenant and ownership isolation;
- input validation, injection, unsafe parsing, path traversal, and command construction;
- secret, token, credential, log, telemetry, and error-message exposure;
- unsafe network access, SSRF, redirects, webhook verification, and trust of remote content;
- data integrity, concurrency, replay, state transitions, and partial updates;
- cryptography, randomness, signing, session/cookie behavior, and insecure defaults;
- dependency, build, CI, configuration, and supply-chain exposure introduced by the change;
- permission expansion, sandbox escapes, prompt injection, and unsafe agent/tool boundaries where applicable.

Trace realistic input-to-impact paths. Check compensating controls before filing. Do not inflate severity or turn generic hardening advice into a vulnerability.

```markdown
# Security review result
- Status: pass | fail | blocked
- Baseline: <SHA>
- Reviewed revision: <construction SHA>

## Validated risks
- [SEC-<stable id>] <severity and title>
  - Location: <path/symbol>
  - Attack path: <preconditions through impact>
  - Evidence: <code/runtime/check evidence>
  - Remediation: <required outcome, not a speculative rewrite>

## Informational notes
- <non-blocking hardening note>

## Checks performed
- <inspection or command>

## Blockers
- <none or exact blocker>
```

Return `fail` for any validated risk regardless of severity. Return `pass` when none exist. Use `blocked` when the pinned revision or necessary evidence cannot be accessed.
