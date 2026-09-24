# Cost-adaptive assurance

Choose the lightest lane that addresses the changed behavior and credible failure cost. Record the lane, reasons, selected stages, and escalation triggers in the work journal before plan approval. The human may request a stricter lane. Never use a cheaper lane to bypass a repository-required check or a validated risk.

## Lanes

### Light

Use for local, reversible changes with a small change surface, no trust-boundary or persistence change, no migration or compatibility burden, and cheap failure.

- The parent performs repository mapping and solution design directly; no planning specialist is required.
- `construct-work` implements production code and focused tests together.
- Run repository-required deterministic checks and a targeted parent diff/acceptance review.
- Add an independent specialist only when implementation evidence triggers escalation.

### Standard

Use by default for ordinary product work spanning more than one file or layer, observable UI or API behavior, routine persistence changes, or moderate regression risk without a high-consequence trust boundary.

- Use at most one planning specialist by default. The parent performs the complementary mapping or design work and still emits the required planning artifacts.
- `construct-work` implements production code and focused tests together.
- Run repository-required deterministic checks.
- Use one independent verification pass that covers the changed security surface, approved runtime acceptance criteria, and structural code quality. The parent may delegate the pass to the most relevant reviewer or run independent reviewers in parallel only when their evidence genuinely requires different capabilities.
- Publish a draft PR/MR after the first clean construction checkpoint and deterministic checks when remote CI or human visibility will shorten feedback.

### High assurance

Use when the change affects authentication, authorization, secrets, payments, destructive or regulated data, migrations with material rollback cost, public compatibility contracts, supply-chain execution, safety-critical behavior, broad concurrency, or another high-consequence failure mode. Also use when repository policy or the human explicitly requires it.

- Run the full planning sequence with `map-codebase`, `design-solution`, and triggered `review-technical-plan`.
- Keep production construction and independent test authoring separate.
- Run pinned `review-security`, deterministic checks, `verify-qa`, and `review-code-quality` as distinct gates.
- Create a ready PR/MR only after all required local gates pass.

## Escalation and scope control

Escalate a lane when discovery or implementation reveals a high-assurance trigger, a materially larger blast radius, an untestable critical path, or repeated failures that undermine the original classification. Record the reason and ask the human before a material cost increase unless immediate escalation is required by repository policy or safety.

Keep acceptance criteria tied to the requested outcome and credible regressions. Label additional resilience, hardening, infrastructure, and exhaustive edge-case work as optional. Do not silently turn optional hardening into a publication blocker; ask the human when it materially expands scope or verification cost.

Do not introduce a new test framework, browser harness, service emulator, vendored dependency, or bespoke benchmark suite solely to satisfy the workflow without first showing why repository-native checks are insufficient. For light and standard work, prefer focused existing seams and a bounded manual/runtime check.

## Cost checkpoints

Before adding a specialist beyond the selected lane, starting a second remediation cycle, or building new verification infrastructure, report the evidence gap, expected benefit, and cheaper alternative. If account usage is visible, also check whether the remaining allowance can complete the proposed stage. Pause for the human when the cost increase is material.

Agent count is a guardrail, not a target: light normally uses one writable specialist, standard one writable specialist plus at most one independent verification pass, and high assurance uses the full specialist pipeline. Reuse existing specialists for related follow-up work instead of spawning replacements.
