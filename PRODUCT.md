# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Agent Factory serves both individual software developers and engineering teams. They use it when turning product ideas, tickets, specifications, pull requests, or other delivery inputs into reviewed software changes while retaining explicit human control over consequential decisions.

## Product Purpose

Agent Factory is a portable, end-to-end software-delivery workflow built from skills and specialist agents. It helps users shape work, plan implementation, construct changes, test and review them, publish a ready pull request or merge request, and monitor feedback through a human-gated lifecycle.

Success means continually improving the agents' abilities, strengthening the available skills, and making the complete shaping-to-handoff experience more robust.

## Positioning

The workflow operates natively across Codex, Claude Code, and OpenCode without introducing its own orchestration service, database, daemon, or task-running CLI. The host supplies agents, tools, parallel execution, and waiting while Agent Factory supplies a portable, disciplined delivery lifecycle.

## Operating Context

- Users begin with either `shape-work` for immature product inputs or `do-work` for a delivery-ready item.
- Shaping and delivery are separate lifecycles; ready work remains human-selected rather than automatically entering implementation.
- Each approved work item runs in a dedicated branch and sibling Git worktree created from a recorded baseline.
- Specialist agents have bounded roles for research, challenge, construction, test authoring, security review, QA, code-quality review, and remote change monitoring.
- GitHub and GitLab are the supported remote collaboration environments described by the repository.

## Capabilities and Constraints

- Supports Codex, Claude Code, and OpenCode through portable skills and native agent adapters.
- Requires explicit plan approval before production code changes begin.
- Uses an interrogated planning sequence of initial questions, repository discovery, read-only mapping, solution design, conditional technical-plan review, reconciliation, exact final-artifact review, and explicit approval before construction.
- Uses a single production-code writer; review roles are read-only, and the test author may edit only tests and fixtures.
- Uses versioned planning-result and technical-blueprint contracts with artifact identity, baseline SHA, canonical content hash, unresolved decisions, and acceptance/verification mappings.
- Requires runtime evidence for observable behavior and treats validated security and code-quality findings as publication blockers.
- Preserves the invoking checkout by performing approved work in a dedicated worktree.
- Never merges, enables auto-merge, changes branch-protection rules, deploys, or stores secrets.
- Evaluates planning behavior with a portable deterministic runner over sanitized committed fixtures only; required assertion recall must be 100% and forbidden matches must be 0%.
- Stops for human decisions at investment, approval, merge, deployment, conflict, unsafe-request, scope-expansion, and missing-authority gates.
- The current documentation surface is an early React 19, TypeScript, and Vite 8 project under `docs-site/`.

## Brand Commitments

The product name is **Agent Factory**. Its established voice is direct, technical, evidence-led, and explicit about authority boundaries. Future work should preserve accurate terminology for skills, agents, lifecycle stages, human gates, branches, worktrees, pull requests, and merge requests.

## Evidence on Hand

- `README.md` contains the canonical product overview, lifecycle diagrams, operating rules, installation instructions, supported hosts, and development validation commands.
- `agents/manifest.json` records the permission boundaries of the specialist roles.
- `.agents/skills/`, `agents/`, and `adapters/` contain the canonical skills, neutral role descriptions, and host-specific definitions.
- `tests/` and `scripts/validate.py` provide lifecycle scenarios, installer tests, and static contract validation.
- The repository contains no testimonials, customer logos, benchmarks, pricing, or other commercial proof; future surfaces must not fabricate them.

## Product Principles

1. Keep consequential decisions human-gated and authority boundaries explicit.
2. Improve agent capability without weakening specialist role separation or verification rigor.
3. Make the complete path from rough input to review-ready change coherent, robust, and resumable.
4. Preserve portability across Codex, Claude Code, and OpenCode without adding a proprietary orchestration runtime.
5. Prefer repository evidence and runtime proof over assumptions or unverifiable claims.
