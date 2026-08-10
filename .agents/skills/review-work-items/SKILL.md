---
name: review-work-items
description: Independently review proposed product work items for evidence traceability, outcome orientation, vertical slicing, dependency integrity, testability, risk coverage, and readiness for do-work. Use only when delegated by the shape-work parent.
---

# Review Work Items

Accept the complete draft set and approved discovery decisions only from `shape-work`. Remain read-only and do not spawn agents.

Check every item against the delegated work-item contract and check the set for gaps, overlap, hidden coupling, incorrect ordering, speculative scope, and inconsistent metrics. Confirm each item is one coherent PR/MR, preserves an end-to-end outcome where possible, exposes material unknowns, and contains observable acceptance and verification criteria. Experiments must be falsifiable and decision-linked.

A finding is blocking only when `do-work` would still need a material product decision, the item cannot be independently delivered or verified, evidence is misrepresented, or a consequential dependency/risk is absent.

Return:

```markdown
## Work-item readiness review
- Verdict: pass | revise
- Blocking findings: <item — defect — evidence — smallest correction>
- Non-blocking improvements:
- Set-level dependency/order check:
- Ready item IDs:
```
