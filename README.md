# Agent Factory

Agent Factory is a provider- and harness-neutral orchestration core for an agent-controlled software-development lifecycle. The factory owns durable workflow decisions; replaceable harness adapters execute one bounded, permissioned agent task and return typed events and artifacts.

## Architecture

```mermaid
flowchart LR
  Human --> Factory[Workflow engine]
  Factory --> Repositories[(Runs / stages / events / artifacts / approvals)]
  Factory --> Negotiation[Capability negotiation]
  Negotiation --> Codex
  Negotiation --> Claude[Claude Code]
  Negotiation --> OpenCode
  Negotiation --> Scripted[Scripted test harness]
  Factory --> Tools[Deterministic tools and external event services]
  Scripted --> Events[Neutral event stream]
  Events --> Factory
  Factory --> Gate[Artifact validation and quality gates]
  Gate --> Human
```

- **Factory**: state, routing, dependencies, exclusive workspace writers, retries, invalidation, approvals, audit history, and escalation.
- **Harness**: a Codex, Claude Code, OpenCode, or other execution surface. It materializes native configuration, invokes/cancels work, and translates events. It is not the model provider.
- **Provider/model profile**: resolves a logical profile to a harness/provider model at deployment time; canonical agents contain no model names.
- **Agent**: reasons inside one bounded task and returns one typed artifact.
- **Skill**: focused reusable instructions stored under `.agents/skills/<name>/SKILL.md`.
- **Tool**: an explicit deterministic operation with structured arguments and an allowlist.
- **Workflow/stage**: a versioned dependency graph and one schedulable unit within it.
- **Event**: normalized, append-only execution evidence.
- **Artifact**: validated, lineage-bearing stage output bound to a source revision.

The complete target lifecycle (planning through post-deployment verification and rollback) is represented by the domain vocabulary. The first executable workflow deliberately proves the smaller planning → approval → construction → test → independent review → quality-gate slice, including remediation.

## Repository structure

| Path                        | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `src/domain.ts`             | Provider-neutral schemas and types                                  |
| `src/workflow.ts`           | Dependency scheduler, approval, remediation, retries, writer lock   |
| `src/harness.ts`            | Adapter contract, negotiation, scripted adapter, external scaffolds |
| `src/artifacts.ts`          | Artifact validation and explicit invalidation rules                 |
| `src/repositories.ts`       | Persistence interfaces and in-memory implementation                 |
| `.agent-factory/agents/`    | Canonical agent definitions                                         |
| `.agent-factory/workflows/` | Canonical workflow definitions                                      |
| `.agents/skills/`           | Canonical, harness-neutral skills                                   |
| `examples/`                 | Runnable input                                                      |

## Run the vertical slice

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm agent-factory run examples/work-items/example.yaml
pnpm validate
```

The local command uses the deterministic scripted adapter, prints the approval identifier, simulates explicit local-human approval, fails the first review, remediates through the construction agent, invalidates old evidence, and completes on the second review. Programmatic callers may instead retain the repository and call `approve` later.

## Creating definitions

### Agent

Add a validated YAML document to `.agent-factory/agents`. Select logical skill IDs, least-privilege tools and permissions, a logical model profile, bounded turns/time, and an output schema. Planning and reviewers are read-only; only construction and testing roles receive scoped write access. The engine rejects simultaneous writable stages.

### Skill

Create `.agents/skills/<name>/SKILL.md` with YAML frontmatter containing `name`, `version`, `description`, `triggers`, `inputs`, and `outputs`, followed by focused instructions. Optional `scripts/` and `references/` live beside it. Paths are resolved beneath the canonical root and traversal is rejected.

### Workflow

Add a versioned YAML workflow with stages, dependencies, input/output artifact types, permissions, and required harness capabilities. Dependencies must complete before scheduling. Approval stages pause durably. A quality gate routes findings back to construction—not to a review agent with write access—and bounded policies prevent feedback loops.

## Adding a harness

Implement `HarnessAdapter`: declare capabilities, map canonical definitions to disposable native files, stream normalized `AgentEvent`s, and cancel runs. Scheduling calls capability negotiation first; absent guarantees raise `HarnessCompatibilityError` rather than silently degrading. External scaffolds currently materialize an initial agent file and truthfully throw `UnsupportedHarnessOperationError` for run/cancel.

Canonical files in `.agent-factory/agents` and `.agents/skills` are the source of truth. `.codex/agents`, `.claude/{agents,skills}`, and `.opencode/agents` are generated, ignored, disposable build artifacts and must never be edited as canonical configuration. Credentials are neither schemas nor prompt inputs; deployment adapters must obtain them out of band and redact tool output.

## Security model

All definitions, prompts, repository content, tool output, and review comments are untrusted. Zod validates boundaries; definition loading confines real paths; permissions deny filesystem/network access by default; commands are represented as executable plus arguments and require allowlisting; artifacts and reviews are revision-bound. A production tool service must additionally sandbox processes, redact secrets before persistence, and authorize every requested operation against the task envelope.

## Known limitations / next phases

The current persistence implementation is in-memory, and the CLI auto-approves only to demonstrate one process end-to-end. Codex, Claude Code, and OpenCode invocation/cancellation are honest scaffolds, not production integrations. Branch/worktree tooling, parallel read-only verification, Git hosting, event-driven CI/review monitors, deployment/rollback, distributed leases, budgets, and encrypted persistent audit storage are intentionally deferred behind the existing interfaces.

Recommended next work: (1) add a transactional SQLite repository plus resumable CLI/API approval commands, (2) implement one real harness adapter and sandboxed deterministic tool service with secret redaction, and (3) extend the workflow with parallel security/QA review and event-driven Git/CI/deployment services.
