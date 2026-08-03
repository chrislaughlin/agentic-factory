# Strict code-quality rubric

## Approval bar

Require all of the following:

- the change faithfully implements the approved plan without missing behavior or scope creep;
- no correctness, concurrency, error-handling, compatibility, or data-integrity defect is evident;
- no clear structural regression or avoidable architecture-boundary leak remains;
- no plausible high-confidence restructuring would delete a meaningful amount of incidental complexity;
- no ad hoc branching, scattered special cases, thin wrappers, magic behavior, or unnecessary generic machinery obscures a simpler model;
- types and boundaries express real invariants without unjustified casts, `any`, `unknown`, nullable modes, or optionality;
- canonical modules and existing helpers own the behavior; duplication and feature leakage are absent;
- independent operations are not needlessly serialized and related state changes are not needlessly non-atomic;
- files and modules remain cohesive. Treat crossing from below 1,000 lines to above 1,000 as a presumptive blocker unless the structure clearly justifies it;
- tests are legible, behavior-focused, and sufficient for the changed risks.

Look for a “code-judo” move: a reframing that makes branches, helpers, modes, layers, or concepts disappear while preserving behavior. Do not demand speculative rewrites, preference-only churn, or cosmetic nits. Validate repository context before filing.

## Output

```markdown
# Code-quality result
- Status: pass | fail | blocked
- Baseline: <SHA>
- Reviewed revision: <tested SHA>

## Validated findings
- [CQ-<stable id>] <title>
  - Category: spec | correctness | structure | boundary | type | duplication | orchestration | tests
  - Location: <path/symbol>
  - Evidence: <specific diff/context evidence>
  - Why blocking: <concrete maintenance or behavior cost>
  - Required outcome: <what must become true>

## Checks performed
- <standards, diff, surrounding paths, commands>

## Blockers
- <none or unavailable input>
```

Return `fail` when any validated finding exists and `pass` only when the approval bar is met. Use `blocked` when the baseline, tested revision, plan, or required standards cannot be accessed.
