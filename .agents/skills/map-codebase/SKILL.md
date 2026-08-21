---
name: map-codebase
description: Build a read-only, evidence-led map of the repository before solution design or construction.
---

# Map Codebase

Use this skill as a bounded planning specialist. Inspect the repository without editing it, and return a concise map that another specialist can use to design a solution.

## Method

1. Confirm the supplied worktree, branch, baseline, and expected revision. Do not inspect a mutable checkout when a commit-addressed revision is required.
2. Read repository instructions, manifests, entry points, architecture notes, relevant source, tests, scripts, and CI configuration. Prefer `rg --files` and `rg`.
3. Trace the requested behavior through its current owners, callers, shared types or schemas, persistence and integration boundaries, and verification surfaces.
4. Record facts with paths and symbols. Label assumptions and unknowns instead of filling them in.
5. Identify the smallest likely change surface, adjacent callers, compatibility constraints, failure modes, and verification commands.

## Output

Return a planning result conforming to [planning-result-v1](../do-work/references/contracts/planning-result-v1.md). The result must include an artifact ID, baseline SHA, content hash, `repository_map.unknowns` (use `[]` when no unknowns exist), unresolved decisions, acceptance mapping, and verification mapping. A map is read-only evidence: it does not authorize design or construction.

Do not edit files, spawn agents, publish changes, or take ownership of the `do-work` lifecycle.
