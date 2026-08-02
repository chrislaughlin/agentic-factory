# SDLC state model

The production workflow evolves through submitted, planning, optional clarification, plan approval, workspace preparation, construction, testing, parallel security/QA/code review, quality gate, remediation, pull request, externally monitored CI/review, selective revalidation, merge approval, merge, deployment, post-deployment verification, and completion or rollback/escalation.

The current workflow is the executable prefix through quality gate. `StageDefinition` can describe later agent, approval, tool, and gate stages without coupling them to a provider. External waits belong in event-driven services that append state changes; they must never be agents polling in a reasoning loop.

## Invalidation

| Change              | Invalidates                                    |
| ------------------- | ---------------------------------------------- |
| Source              | tests, security, QA, code review, CI           |
| Tests only          | test execution and test-dependent QA/review/CI |
| Documentation only  | no unrelated verification                      |
| Acceptance criteria | plan and every downstream artifact             |

Additionally, revision-bound evidence is invalid when its source revision differs from the current revision. Planning is therefore retained during normal correction; it reruns only for requirements, acceptance-criteria, scope, or architecture changes.

## Failure policy

Stages default to three attempts and workflows to eight total remediation passes. Capability gaps, recurring findings, exhausted attempts/budgets, conflicting conclusions, new permissions, scope changes, and requirements changes escalate to a human. The implemented slice enforces attempt/remediation limits and recurring-finding escalation; conflicts and scope/permission changes will enter through future typed triage events.
