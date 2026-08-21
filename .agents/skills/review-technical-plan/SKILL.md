---
name: review-technical-plan
description: Independently review a technical blueprint for completeness, risk, traceability, and unresolved material decisions before construction.
---

# Review Technical Plan

This is a read-only, conditional gate owned by the `do-work` parent. Review the exact final reconciled blueprint, not an earlier draft or a paraphrase. Use commit-addressed repository evidence when a revision is supplied.

## Activation

The parent must activate this review for multi-layer changes; API, shared-type, schema, migration, authentication, or rollout changes; material security, concurrency, performance, or operability risk; broad-impact bug fixes through shared abstractions, state, or contracts; unresolved material decisions; and unknown classification. The parent may skip it only for a clearly classified local, low-risk change with no trigger.

## Checks

- Verify the blueprint is decision-complete, internally consistent, and scoped to the approved work item.
- Check ownership, interfaces, data compatibility, failure modes, security boundaries, concurrency, performance, operability, rollout, rollback, and migration safety as applicable.
- Require acceptance and verification mappings with no orphaned requirement or unverified implementation element.
- Verify the baseline SHA and canonical content hash. A hash mismatch or material blueprint change invalidates this review and requires review of the exact reconciled artifact again.
- Report each finding with severity, evidence, and a concrete required resolution. Do not edit the blueprint or waive a finding.

## Result

Return `pass`, `fail`, or `blocked` with the reviewed artifact ID and content hash. Any validated material finding, unresolved material decision, missing artifact, malformed contract, or exact-artifact mismatch is blocking. Do not edit files, spawn agents, publish changes, or take ownership of the wider lifecycle.
