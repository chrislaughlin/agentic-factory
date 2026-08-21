---
name: design-solution
description: Turn repository evidence and approved decisions into a versioned technical blueprint without writing production code.
---

# Design Solution

Use this skill after repository mapping and the second human decision gate. Design the smallest coherent solution that satisfies the approved scope and preserves the repository's architecture and authority boundaries.

## Method

1. Use the current map, approved decisions, baseline SHA, and work-item acceptance criteria as inputs. Do not rediscover facts by assumption.
2. Describe interfaces, data or schema changes, ownership, sequencing, compatibility, failure handling, security, concurrency, performance, operability, rollout, and rollback where relevant.
3. Map every acceptance criterion to an implementation element and every implementation element to a deterministic or runtime verification method.
4. List unresolved decisions explicitly. Do not hide a material choice in prose; return the item to the human gate when it affects scope, safety, compatibility, or operational risk.
5. Produce the exact versioned technical blueprint described by [technical-blueprint-v1](../do-work/references/contracts/technical-blueprint-v1.md), including its artifact ID, baseline SHA, canonical content hash, and mappings.

The blueprint is a planning artifact, not approval to edit production code. Do not edit files, spawn agents, publish changes, or take ownership of the `do-work` lifecycle.
