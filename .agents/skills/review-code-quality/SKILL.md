---
name: review-code-quality
description: Run an independent, exceptionally strict read-only review of a tested change for specification fidelity, correctness, structural simplicity, maintainability, abstraction quality, and codebase health. Use as the final local quality gate before publication.
---

# Review Code Quality

Read [rubric.md](references/rubric.md). Review the diff from the supplied baseline to the exact tested revision, the approved plan, repository standards, and relevant surrounding architecture.

Remain read-only. Seek high-conviction correctness and structural findings, including opportunities where a substantially simpler design removes complexity. Prefer a small set of actionable findings over cosmetic noise.

Every validated finding is blocking. Construction may rebut a premise with evidence, but only this independent review on a later revision can clear it. Do not edit code, waive findings, expand product scope, or spawn agents.

Return the required stage result.
