# SDLC state model

The production workflow evolves through submitted, planning, optional clarification, plan approval, workspace preparation, construction, testing, parallel security/QA/code review, quality gate, remediation, pull request, externally monitored CI/review, selective revalidation, merge approval, merge, deployment, post-deployment verification, and completion or rollback/escalation.

The checked-in workflow executes the local prefix through quality gate; the GitHub and release lifecycle services then carry the same durable run through pull request, CI/review, final approval, merge, deployment, smoke verification, and terminal cleanup. External waits are one-shot, cursor-backed observations invoked by `resume`; they never occupy an agent reasoning loop.

## Invalidation

| Change              | Invalidates                                    |
| ------------------- | ---------------------------------------------- |
| Source              | tests, security, QA, code review, CI           |
| Tests only          | test execution and test-dependent QA/review/CI |
| Documentation only  | no unrelated verification                      |
| Acceptance criteria | plan and every downstream artifact             |

Additionally, revision-bound evidence is invalid when its source revision differs from the current revision. Planning is therefore retained during normal correction; it reruns only for requirements, acceptance-criteria, scope, or architecture changes.

## Failure policy

Stages default to three attempts and workflows to eight total remediation passes. Capability gaps, recurring findings, exhausted attempts/budgets, unclassified feedback, merge races, revision mismatches, malformed provider responses, deployment failures without rollback, and failed rollback all stop or escalate safely. Scope, permissions, or acceptance-criteria changes remain explicit operator decisions rather than inferred remediation.
