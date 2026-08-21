# Planning interrogation and artifact gates

`do-work` owns this sequence and asks one material human question at a time. Repository facts come from discovery and mapping, not from the human.

1. **Initial questions** — establish the desired outcome, users or callers, constraints, deadline or rollout concern, and what must remain unchanged. Recommend an answer for each material choice and record the response.
2. **Repository discovery** — inspect instructions, architecture, manifests, commands, runtime surfaces, Git identity, and relevant tests. Record sources in the private journal.
3. **Mapping** — delegate or perform read-only `map-codebase`. Capture a `planning-result.v1` artifact with artifact ID, baseline SHA, content hash, `repository_map.unknowns` (including `[]` when none exist), unresolved decisions, and acceptance/verification mappings.
4. **Follow-up** — ask only the next material question exposed by the map. Stop when the decision is resolved or explicitly unresolved; never silently choose a consequential behavior.
5. **Design** — delegate or perform read-only `design-solution`. Capture the exact `technical-blueprint.v1` artifact with scope, interfaces, implementation, risk controls, classification, unresolved decisions, and mappings.
6. **Follow-up** — ask one material question at a time for design choices, compatibility, rollout, or failure handling. Update the artifact and content hash after each answer.
7. **Conditional review** — activate `review-technical-plan` when any trigger in the skill or contract applies. A malformed artifact, missing mapping, unresolved material decision, unknown classification, or unavailable required evidence blocks.
8. **Reconciliation** — resolve findings and record changes. Do not weaken acceptance criteria or broaden scope. Recompute the canonical hash.
9. **Exact final artifact review** — review the final reconciled blueprint again if material content changed or the hash differs from the reviewed artifact. The reviewer receives the exact artifact ID and hash.
10. **Explicit approval** — show the decision-complete plan, exact blueprint identity and hash, scope, risks, acceptance criteria, and verification commands. Wait for an unambiguous human approval.
11. **Construction** — only after approval, create or validate the isolated worktree and delegate production changes to `construct-work`.

## Artifact integrity

Canonical JSON hashes use sorted object keys, UTF-8, compact separators, and omit only `content_hash`. A hash mismatch makes downstream review evidence stale. Live planning artifacts and model outputs remain private; only sanitized fixtures and recorded results belong in Git.

Before technical-plan review and again before explicit approval, run the portable local gate `python3 scripts/validate_planning_artifact.py --stage review` or `--stage approval` with the artifact, expected revision, and repository. Final stages require `status: complete` and no unresolved material decisions. Use `--stage advisory` only when explicitly validating a non-final draft. The gate recomputes `content_hash` and resolves `baseline_sha` against the expected Git revision without network or model access. Missing expected revision context, a malformed or tampered artifact, an incomplete final artifact, an unresolved final decision, or an unresolved/mismatched revision fails closed; never substitute syntax validation for this gate.

## Construction boundary

`construct-work` is the sole production-code writer. No planning specialist edits production sources, and no specialist takes ownership of the lifecycle. The parent retains the construction, verification, QA, publication, monitoring, merge, and deployment gates.
