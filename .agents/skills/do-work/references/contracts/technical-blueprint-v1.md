# Technical blueprint v1

`contracts/technical-blueprint-v1.json` is the versioned machine-readable contract for the exact solution proposed for construction. It records `artifact_id`, the immutable `baseline_sha`, canonical `content_hash`, change classification, scope, implementation, risk controls, unresolved decisions, and acceptance and verification mappings.

The technical-plan review is required for multi-layer, API/shared-type/schema/migration/auth/rollout, material security/concurrency/performance/operability, broad-impact bug-fix, unresolved-decision, and unknown classifications. A local low-risk change may skip review only when its classification and absence of triggers are explicit.

Review always applies to the exact final reconciled blueprint. If reconciliation changes material content or the hash does not match, discard the prior review and review the new exact artifact before asking for approval.

Before each exact-artifact review and before approval, run `scripts/validate_planning_artifact.py` with the artifact and recorded expected baseline revision. Syntax-valid metadata is insufficient: the gate recomputes `content_hash`, resolves `baseline_sha` locally, and fails closed when expected revision context is absent or either check fails.
