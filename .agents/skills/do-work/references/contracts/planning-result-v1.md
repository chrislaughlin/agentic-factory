# Planning result v1

`contracts/planning-result-v1.json` is the versioned machine-readable contract for repository mapping and planning evidence. A result records `schema_version`, `kind: planning-result`, `role: map-codebase`, `status`, `artifact_id`, the immutable `baseline_sha`, a canonical `content_hash` (`sha256:<hex>`), unresolved decisions, and explicit acceptance and verification mappings.

The content hash is computed from canonical JSON with sorted object keys, UTF-8 encoding, and the `content_hash` property omitted. The hash covers the exact artifact, including mappings and unresolved decisions. Any material edit requires a new hash and a fresh final-artifact review.

The parent must run `scripts/validate_planning_artifact.py` with the recorded expected baseline revision before review and approval. The gate recomputes the hash and resolves `baseline_sha` locally; missing revision context, a changed artifact, or a revision mismatch fails closed.

The contract is a planning artifact only. It cannot authorize construction; the parent `do-work` skill owns the approval gate.
