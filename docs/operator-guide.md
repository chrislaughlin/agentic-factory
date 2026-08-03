# Operator guide

## Install

Use Node.js 22 or newer, pnpm, Git, and the authenticated GitHub CLI. Run `pnpm install`, then `pnpm agent-factory doctor`. pnpm build scripts are explicitly restricted to `esbuild` in `pnpm-workspace.yaml`.

## Configure

Canonical agents and workflows live in `.agent-factory`; skills live in `.agents/skills`. The local backend defaults to workflow `local-sdlc`, harness `scripted`, model profile `balanced`, the repository's detected default branch, and `.agent-factory/factory.db`.

Deployment, smoke, and optional rollback commands are JSON arrays so no shell parses them:

```bash
export AGENT_FACTORY_HARNESS_COMMAND='["./bin/my-ndjson-harness"]'
export AGENT_FACTORY_HARNESS_ENVIRONMENT='{"OPENAI_API_KEY":"..."}'
export AGENT_FACTORY_DEPLOY_COMMAND='["./scripts/deploy.sh","production"]'
export AGENT_FACTORY_SMOKE_COMMAND='["./scripts/smoke.sh","https://service.example/health"]'
export AGENT_FACTORY_ROLLBACK_COMMAND='["./scripts/rollback.sh","production"]'
export AGENT_FACTORY_ENVIRONMENT='production'
export AGENT_FACTORY_MERGE_METHOD='squash'
```

Commands are allowlisted as an executable plus fixed arguments. The harness inherits only a minimal process environment plus the explicit JSON object in `AGENT_FACTORY_HARNESS_ENVIRONMENT`; it does not receive the CLI's complete environment. Credentials remain out-of-band; values in configured secret/token/password fields and registered secret literals are redacted from process errors and structured logs before persistence.

Without `AGENT_FACTORY_HARNESS_COMMAND`, the CLI uses the scripted demonstration harness and stops after local verification. Live source changes and PR publication require a configured process harness that edits/commits in `task.workspace.root` and reports the resulting Git SHA as its source revision.

The deploy command receives `AGENT_FACTORY_REVISION`, `AGENT_FACTORY_ENVIRONMENT`, and `AGENT_FACTORY_WORKFLOW_RUN_ID`. After verifying the target environment is serving that revision, its final non-empty stdout line must be JSON such as `{"revision":"<AGENT_FACTORY_REVISION>","deploymentId":"production-123"}`. A successful command without this attestation is rejected. Smoke commands receive the attested revision, deployment ID, and environment through `AGENT_FACTORY_REVISION`, `AGENT_FACTORY_DEPLOYMENT_ID`, and `AGENT_FACTORY_ENVIRONMENT`; rollback commands receive the same binding.

## Operate

```text
agent-factory work "<request>" [--harness scripted] [--workflow local-sdlc] [--model-profile balanced] [--policy default|strict] [--json]
agent-factory list [--json]
agent-factory inspect <run-id> [--json]
agent-factory answer <request-id> --value "<answer>"
agent-factory approve <approval-id> [--actor <name>] [--yes]
agent-factory reject <approval-id> --reason "<reason>" --yes
agent-factory retry <run-id> --stage <stage-id>
agent-factory cancel <run-id> --yes [--reason "<reason>"]
agent-factory resume <run-id>
agent-factory harnesses
agent-factory doctor
```

`resume` advances the state-dependent external lifecycle one step: publish/update the PR, poll CI/reviews, create final approval, or observe deployment. External schedulers may call it periodically; persisted cursors and event keys prevent duplicate processing. A final approval prints its exact head revision and evidence IDs and requires `--yes`.

Exit codes are stable: `0` success, `2` validation/intent error, `3` unavailable dependency, `4` pending approval, and `5` terminal failure/cancellation/rollback/escalation. JSON output uses `agent-factory.dev/cli/v1`.

## Recover

All workflow decisions, approvals, artifacts, events, integration cursors, and external dedupe keys are persisted in SQLite. After interruption, run `agent-factory inspect <run-id>` and then `agent-factory resume <run-id>`. A stage found in `running` is returned to `pending` before rescheduling. Deployment command state is stored under `.agent-factory/deployments`.

If a process died while owning a worktree, inspect the lock in the sibling `.<repository>-worktrees` directory. Do not delete it while its recorded process is alive. `cancel --yes` and terminal release handling remove the exact registered worktree and lock.

## Troubleshoot

- `WORKSPACE_LOCKED`: another workflow owns the repository writer lease; inspect or cancel that run.
- `HARNESS_INCOMPATIBLE`: select a harness whose advertised capabilities satisfy the stage.
- `COMMAND_NOT_ALLOWED`: add the exact executable/argument tuple to trusted configuration; do not fall back to a shell string.
- `STALE_APPROVAL`: inspect the new PR head and request a new final approval.
- GitHub unavailable: run `gh auth status`, confirm `origin`, and rerun `doctor`.
- Deployment escalated: inspect `deployment-result`, `post-deployment-verification`, and `rollback-result` artifacts.

## Extend

Implement `HarnessAdapter`, `GitHubProvider`, or `DeploymentProvider` at the typed boundary. Preserve revision binding, cancellation, one-shot observation, and explicit capabilities. Add artifact validation before persistence and adapter contract tests. Canonical instructions never contain credentials or provider-specific model names.

## Secure deployment

Treat repository content, prompts, tool output, CI logs, and review comments as untrusted. Run Agent Factory under a dedicated OS identity, keep commands least-privilege, protect the SQLite database and deployment-state directory, avoid secrets in command arguments, and use short-lived GitHub/deployment credentials. See [Security boundaries](security.md).
