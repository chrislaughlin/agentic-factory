# Work-item contract

Each item must be independently understandable and small enough for one coherent PR/MR. Use `Unknown` rather than inventing detail.

```markdown
# <Outcome-oriented title>

## Classification
- Type: experiment | product increment | enabler | migration | operational
- Parent outcome: <stable outcome identifier>
- Depends on: <item IDs or none>
- Suggested delivery: Scrum increment | Kanban flow | phase-gated

## Context and evidence
- Problem: <observable current condition and affected users>
- Evidence: <source, date, context/population, confidence>
- Why now: <cost of delay or trigger>

## Intended outcome
- User/business outcome: <behavior or condition to change, not output>
- Success measure: <metric, baseline, target, window>
- Guardrails: <metrics or harms that must not regress>

## Scope
- In: <smallest end-to-end behavior>
- Out: <explicit exclusions and deferred items>
- User journey / behavior: <before, trigger, after>

## Requirements and rules
- <observable rule, interface, policy, data, compatibility, or accessibility need>

## Acceptance criteria
- Given <state>, when <action>, then <observable result>.
- Include failure, empty, boundary, authorization, recovery, and observability behavior where relevant.

## Risks and assumptions
- <assumption> — evidence/confidence — validation or mitigation
- Security, privacy, safety, compliance, operational, and rollout risks

## Delivery and verification
- Rollout/rollback: <reversible release strategy or why not applicable>
- Verification: <runtime evidence and deterministic checks>
- Dependencies/owners: <external decisions, systems, or teams>

## Discovery trace
- Decision: <advance/experiment/reframe/park/phase-gate and approver>
- Alternatives considered: <option and reason rejected>
- Open questions: <owner and deadline; none may block implementation>
```

## Readiness rubric

An item fails readiness if it lacks a testable outcome, has a material unresolved product decision, mixes unrelated outcomes, hides a dependency, prescribes unnecessary implementation, cannot be verified, or has acceptance criteria that merely restate the solution. Experiments additionally require a falsifiable hypothesis, method, population, success/failure thresholds, duration, ethics/privacy constraints, and the decision each result triggers.
