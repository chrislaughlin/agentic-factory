#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  ModelProfileSchema,
  type AgentEvent,
  type ArtifactInstance,
  type WorkflowRun,
} from "./domain.js";
import { GhCliGitHubProvider, GitHubLifecycle, LocalGitRepositoryGateway } from "./github.js";
import { ScriptedHarnessAdapter } from "./harness.js";
import {
  DeterministicCommandRunner,
  GitWorkspaceManager,
  type AllowedCommand,
} from "./infrastructure.js";
import { loadAgent, loadSkills, loadWorkflow } from "./loader.js";
import { SqliteRepositories } from "./repositories.js";
import { CommandDeploymentProvider, ReleaseLifecycle } from "./release.js";
import { WorkflowEngine } from "./workflow.js";

const execute = promisify(execFile);
const CLI_API_VERSION = "agent-factory.dev/cli/v1" as const;

export enum CliExitCode {
  Success = 0,
  ValidationFailure = 2,
  UnavailableDependency = 3,
  PendingApproval = 4,
  TerminalFailure = 5,
}

export interface CliIo {
  writeOut(line: string): void;
  writeError(line: string): void;
}

export interface ApprovalSnapshot {
  id: string;
  kind?: "plan" | "final";
  revision?: string;
  evidenceArtifactIds?: string[];
  status: string;
}

export interface OperatorBackend {
  work(input: {
    objective: string;
    harness?: string;
    workflow?: string;
    repository?: string;
    baseBranch?: string;
    modelProfile?: string;
    policy?: string;
  }): Promise<unknown>;
  list(): Promise<unknown>;
  inspect(workflowRunId: string): Promise<unknown>;
  getApproval(approvalId: string): Promise<ApprovalSnapshot>;
  answer(requestId: string, value: string): Promise<unknown>;
  approve(approvalId: string, actor: string): Promise<unknown>;
  reject(approvalId: string, actor: string, reason: string): Promise<unknown>;
  retry(workflowRunId: string, stageId: string): Promise<unknown>;
  cancel(workflowRunId: string, reason: string): Promise<unknown>;
  resume(workflowRunId: string): Promise<unknown>;
  harnesses(): Promise<unknown>;
  doctor(): Promise<{ ready: boolean; checks: unknown[] }>;
}

interface ParsedArguments {
  command: string;
  positionals: string[];
  options: Map<string, string | true>;
}

export async function runCli(
  arguments_: string[],
  backend: OperatorBackend,
  io: CliIo,
): Promise<CliExitCode> {
  const parsed = parseArguments(arguments_);
  const json = parsed.options.has("json");
  const output = (kind: string, data: unknown) => {
    if (json) io.writeOut(JSON.stringify({ apiVersion: CLI_API_VERSION, kind, data }));
    else io.writeOut(formatHuman(kind, data));
  };
  const fail = (code: string, message: string, details: Record<string, unknown> = {}) => {
    if (json)
      io.writeError(
        JSON.stringify({ apiVersion: CLI_API_VERSION, error: { code, message, ...details } }),
      );
    else io.writeError(`${code}: ${message}`);
  };
  try {
    switch (parsed.command) {
      case "work":
      case "run": {
        const objective = required(parsed.positionals.join(" "), "work requires a request");
        const data = await backend.work({
          objective,
          ...optionalOptions(parsed.options, [
            "harness",
            "workflow",
            "repository",
            "base-branch",
            "model-profile",
            "policy",
          ]),
        });
        output("WorkSubmission", data);
        return statusOf(data) === "waiting-approval"
          ? CliExitCode.PendingApproval
          : exitForStatus(statusOf(data));
      }
      case "list": {
        output("WorkflowList", await backend.list());
        return CliExitCode.Success;
      }
      case "inspect":
      case "status": {
        const data = await backend.inspect(
          required(parsed.positionals[0], "inspect requires a run id"),
        );
        output("WorkflowInspection", data);
        return exitForStatus(statusOf(data));
      }
      case "answer": {
        const requestId = required(parsed.positionals[0], "answer requires a request id");
        const value = required(option(parsed.options, "value"), "answer requires --value");
        output("ClarificationAnswer", await backend.answer(requestId, value));
        return CliExitCode.Success;
      }
      case "approve": {
        const approvalId = required(parsed.positionals[0], "approve requires an approval id");
        const approval = await backend.getApproval(approvalId);
        if (approval.kind === "final" && !parsed.options.has("yes")) {
          fail("CONFIRMATION_REQUIRED", "Final merge/deploy approval requires --yes", {
            revision: approval.revision,
            evidenceArtifactIds: approval.evidenceArtifactIds ?? [],
          });
          return CliExitCode.ValidationFailure;
        }
        const data = await backend.approve(
          approvalId,
          option(parsed.options, "actor") ?? "local-operator",
        );
        output("ApprovalDecision", data);
        return exitForStatus(statusOf(data));
      }
      case "reject": {
        requireConfirmation(parsed, "reject");
        const approvalId = required(parsed.positionals[0], "reject requires an approval id");
        const reason = required(option(parsed.options, "reason"), "reject requires --reason");
        output(
          "ApprovalDecision",
          await backend.reject(
            approvalId,
            option(parsed.options, "actor") ?? "local-operator",
            reason,
          ),
        );
        return CliExitCode.Success;
      }
      case "retry": {
        const runId = required(parsed.positionals[0], "retry requires a run id");
        const stage = required(option(parsed.options, "stage"), "retry requires --stage");
        const data = await backend.retry(runId, stage);
        output("WorkflowControl", data);
        return exitForStatus(statusOf(data));
      }
      case "cancel": {
        requireConfirmation(parsed, "cancel");
        const runId = required(parsed.positionals[0], "cancel requires a run id");
        output(
          "WorkflowControl",
          await backend.cancel(runId, option(parsed.options, "reason") ?? "cancelled by operator"),
        );
        return CliExitCode.Success;
      }
      case "resume": {
        const data = await backend.resume(
          required(parsed.positionals[0], "resume requires a run id"),
        );
        output("WorkflowControl", data);
        return exitForStatus(statusOf(data));
      }
      case "harnesses": {
        output("HarnessList", await backend.harnesses());
        return CliExitCode.Success;
      }
      case "doctor": {
        const data = await backend.doctor();
        output("DoctorReport", data);
        return data.ready ? CliExitCode.Success : CliExitCode.UnavailableDependency;
      }
      default:
        fail(
          "USAGE",
          "Expected work, list, inspect, answer, approve, reject, retry, cancel, resume, harnesses, or doctor",
        );
        return CliExitCode.ValidationFailure;
    }
  } catch (error) {
    const value = error as Error & { code?: string };
    fail(value.code ?? "VALIDATION_ERROR", value.message);
    return value.code === "UNAVAILABLE"
      ? CliExitCode.UnavailableDependency
      : CliExitCode.ValidationFailure;
  }
}

function parseArguments(arguments_: string[]): ParsedArguments {
  const command = arguments_[0] ?? "";
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 1; index < arguments_.length; index++) {
    const value = arguments_[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "json" || name === "yes") options.set(name, true);
    else {
      const next = arguments_[++index];
      if (!next || next.startsWith("--")) throw new Error(`--${name} requires a value`);
      options.set(name, next);
    }
  }
  return { command, positionals, options };
}

function optionalOptions(
  options: Map<string, string | true>,
  names: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = option(options, name);
    if (value) result[toCamelCase(name)] = value;
  }
  return result;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/gu, (_, character: string) => character.toUpperCase());
}

function option(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function required<T>(value: T | undefined | "", message: string): T {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

function requireConfirmation(parsed: ParsedArguments, action: string): void {
  if (!parsed.options.has("yes")) {
    const error = new Error(`${action} requires --yes`) as Error & { code: string };
    error.code = "CONFIRMATION_REQUIRED";
    throw error;
  }
}

function statusOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("status" in data)) return undefined;
  return typeof data.status === "string" ? data.status : undefined;
}

function exitForStatus(status: string | undefined): CliExitCode {
  if (status === "waiting-approval" || status === "waiting-final-approval")
    return CliExitCode.PendingApproval;
  if (new Set(["failed", "escalated", "rolled-back", "cancelled"]).has(status ?? ""))
    return CliExitCode.TerminalFailure;
  return CliExitCode.Success;
}

function formatHuman(kind: string, data: unknown): string {
  const status = statusOf(data);
  const heading = status ? `${kind}: ${status.toUpperCase()}` : kind;
  return `${heading}\n${JSON.stringify(data, null, 2)}`;
}

class LocalOperatorBackend implements OperatorBackend {
  private constructor(
    private readonly root: string,
    private readonly repositories: SqliteRepositories,
    private readonly engine: WorkflowEngine,
    private readonly commands: DeterministicCommandRunner,
  ) {}

  static async create(root: string, databasePath: string): Promise<LocalOperatorBackend> {
    const workflow = await loadWorkflow(
      resolve(root, ".agent-factory/workflows"),
      "local-sdlc.yaml",
    );
    const skills = await loadSkills(resolve(root, ".agents/skills"));
    const agentIds = [
      "planner",
      "constructor",
      "tester",
      "security-reviewer",
      "qa-reviewer",
      "code-reviewer",
    ];
    const agents = await Promise.all(
      agentIds.map((id) => loadAgent(resolve(root, ".agent-factory/agents"), `${id}.yaml`)),
    );
    const repositories = new SqliteRepositories(databasePath);
    for (const value of agents) await repositories.agents.put(value);
    for (const value of skills) await repositories.skills.put(value);
    const harness = createScriptedHarness();
    const profile = ModelProfileSchema.parse({
      id: "balanced",
      providers: { scripted: { model: "deterministic-script" } },
    });
    const configuredCommands = [
      configuredCommand("deploy", "AGENT_FACTORY_DEPLOY_COMMAND"),
      configuredCommand("smoke", "AGENT_FACTORY_SMOKE_COMMAND"),
      configuredCommand("rollback", "AGENT_FACTORY_ROLLBACK_COMMAND"),
    ].filter((command): command is AllowedCommand => Boolean(command));
    const commands = new DeterministicCommandRunner({
      commands: [
        ...["test", "typecheck", "lint", "build", "security"].map((id) => ({
          id,
          executable: "pnpm",
          arguments: [id],
        })),
        ...configuredCommands,
      ],
    });
    const engine = new WorkflowEngine(
      repositories,
      harness,
      workflow,
      new Map(agents.map((value) => [value.metadata.id, value])),
      new Map(skills.map((value) => [value.name, value])),
      new Map([[profile.id, profile]]),
      commands,
    );
    return new LocalOperatorBackend(root, repositories, engine, commands);
  }

  async work(input: {
    objective: string;
    harness?: string;
    workflow?: string;
    repository?: string;
    baseBranch?: string;
    modelProfile?: string;
    policy?: string;
  }) {
    if (input.harness && input.harness !== "scripted")
      throw unavailable(`Harness is not configured: ${input.harness}`);
    if (input.workflow && input.workflow !== "local-sdlc")
      throw unavailable(`Workflow is not configured: ${input.workflow}`);
    const identity = await new LocalGitRepositoryGateway().detect(this.root);
    if (input.repository && input.repository !== identity.repository)
      throw unavailable(`Configured checkout is ${identity.repository}, not ${input.repository}`);
    const runId = `wf-${randomUUID()}`;
    const worktreeRoot = join(dirname(this.root), `.${basename(this.root)}-worktrees`);
    const manager = new GitWorkspaceManager({ repositoryRoot: this.root, worktreeRoot });
    const workspace = await manager.prepare({
      runId,
      baseBranch: input.baseBranch ?? identity.defaultBranch,
    });
    try {
      const run = await this.engine.submit(
        input.objective,
        workspace.baseRevision,
        workspace,
        runId,
      );
      run.configuration = {
        harness: input.harness ?? "scripted",
        workflow: input.workflow ?? "local-sdlc",
        repository: identity.repository,
        baseBranch: input.baseBranch ?? identity.defaultBranch,
        modelProfile: input.modelProfile ?? "balanced",
        ...(input.policy ? { policy: input.policy } : {}),
      };
      await this.repositories.workflowRuns.save(run);
      const approval = (await this.repositories.approvals.list(run.id)).find(
        (candidate) => candidate.status === "pending",
      );
      return { runId: run.id, status: run.status, approvalId: approval?.id };
    } catch (error) {
      await manager.cleanup(runId);
      throw error;
    }
  }

  async list() {
    return (await this.repositories.workflowRuns.list()).map((run) => ({
      id: run.id,
      objective: run.objective,
      status: run.status,
      revision: run.revision,
    }));
  }

  async inspect(workflowRunId: string) {
    const run = await this.engine.get(workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${workflowRunId}`);
    return {
      ...run,
      approvals: await this.repositories.approvals.list(run.id),
      artifacts: await this.repositories.artifacts.list(run.id),
      events: await this.repositories.events.list(run.id),
      externalEvents: await this.repositories.externalEvents.list(run.id),
    };
  }

  async getApproval(approvalId: string): Promise<ApprovalSnapshot> {
    const approval = await this.repositories.approvals.get(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    return approval;
  }

  async answer(requestId: string, value: string) {
    for (const run of await this.repositories.workflowRuns.list()) {
      const request = (await this.repositories.artifacts.list(run.id)).find(
        (candidate) =>
          candidate.type === "clarification-request" &&
          (candidate.content as { requestId?: string }).requestId === requestId,
      );
      if (!request) continue;
      await this.repositories.artifacts.save(
        run.id,
        localArtifact("clarification-answer", "operator", run.revision, { requestId, value }),
      );
      return { requestId, status: "answered" };
    }
    throw new Error(`Clarification request not found: ${requestId}`);
  }

  async approve(approvalId: string, actor: string) {
    const approval = await this.repositories.approvals.get(approvalId);
    if (approval?.kind === "final") {
      const run = await this.engine.get(approval.workflowRunId);
      if (!run) throw new Error(`Workflow not found: ${approval.workflowRunId}`);
      const pullRequest = (await this.repositories.artifacts.list(run.id))
        .filter((artifact) => artifact.type === "pull-request" && artifact.validation.valid)
        .at(-1)?.content as { repository?: string; number?: number } | undefined;
      if (!pullRequest?.repository || !pullRequest.number)
        throw new Error(`Workflow ${run.id} has no current pull request`);
      const method = process.env.AGENT_FACTORY_MERGE_METHOD ?? "squash";
      if (!new Set(["merge", "squash", "rebase"]).has(method))
        throw new Error(`Unsupported merge method: ${method}`);
      const released = await this.releaseLifecycle(run).approveAndDeploy(approvalId, actor, {
        repository: pullRequest.repository,
        pullRequestNumber: pullRequest.number,
        mergeMethod: method as "merge" | "squash" | "rebase",
        environment: process.env.AGENT_FACTORY_ENVIRONMENT ?? "production",
        smokeCommandIds: ["smoke"],
      });
      return { runId: released.id, status: released.status, revision: released.revision };
    }
    const run = await this.engine.approve(approvalId, actor);
    return { runId: run.id, status: run.status, revision: run.revision };
  }

  async reject(approvalId: string, actor: string, reason: string) {
    const run = await this.engine.reject(approvalId, actor, reason);
    await this.cleanupWorkspace(run).catch(() => {});
    return { runId: run.id, status: run.status };
  }

  async retry(workflowRunId: string, stageId: string) {
    const run = await this.engine.retry(workflowRunId, stageId);
    return { runId: run.id, status: run.status };
  }

  async cancel(workflowRunId: string, reason: string) {
    const run = await this.engine.cancel(workflowRunId, reason);
    await this.cleanupWorkspace(run).catch(() => {});
    return { runId: run.id, status: run.status };
  }

  async resume(workflowRunId: string) {
    let run = await this.engine.get(workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${workflowRunId}`);
    if (run.status === "locally-verified") {
      await new GitHubLifecycle(
        this.repositories,
        new GhCliGitHubProvider(),
        new LocalGitRepositoryGateway(),
      ).publish(run.id, { title: run.objective, body: "Agent Factory local quality gate passed." });
    } else if (run.status === "waiting-ci" || run.status === "waiting-review") {
      const result = await new GitHubLifecycle(
        this.repositories,
        new GhCliGitHubProvider(),
        new LocalGitRepositoryGateway(),
      ).poll(run.id);
      run = (await this.engine.get(run.id))!;
      if (result.readyForFinalApproval) {
        const pendingFinal = (await this.repositories.approvals.list(run.id)).find(
          (approval) => approval.kind === "final" && approval.status === "pending",
        );
        if (!pendingFinal) {
          const evidence = (await this.repositories.artifacts.list(run.id))
            .filter(
              (artifact) => artifact.validation.valid && artifact.sourceRevision === run!.revision,
            )
            .map((artifact) => artifact.id);
          await this.releaseLifecycle(run).requestFinalApproval(run.id, evidence);
        }
      }
    } else if (run.status === "deploying" || run.status === "verifying") {
      run = await this.releaseLifecycle(run).observe(run.id);
      if (new Set(["completed", "rolled-back"]).has(run.status))
        await this.cleanupWorkspace(run).catch(() => {});
    } else {
      run = await this.engine.resume(run.id);
    }
    run = (await this.engine.get(run.id))!;
    const pendingApproval = (await this.repositories.approvals.list(run.id)).find(
      (approval) => approval.status === "pending",
    );
    return {
      runId: run.id,
      status: run.status,
      revision: run.revision,
      ...(pendingApproval ? { approvalId: pendingApproval.id } : {}),
    };
  }

  async harnesses() {
    return [
      { id: "scripted", ready: true, purpose: "deterministic local demonstration" },
      { id: "process", ready: true, purpose: "real NDJSON subprocess harness" },
      { id: "codex", ready: false, purpose: "requires deployment adapter configuration" },
      { id: "claude-code", ready: false, purpose: "requires deployment adapter configuration" },
      { id: "opencode", ready: false, purpose: "requires deployment adapter configuration" },
    ];
  }

  async doctor() {
    const checks: Array<{ name: string; ready: boolean; detail: string }> = [];
    try {
      const identity = await new LocalGitRepositoryGateway().detect(this.root);
      checks.push({
        name: "repository",
        ready: true,
        detail: `${identity.repository} (${identity.defaultBranch})`,
      });
    } catch (error) {
      checks.push({ name: "repository", ready: false, detail: String(error) });
    }
    checks.push({
      name: "persistence",
      ready: true,
      detail: "SQLite opened and migrations applied",
    });
    checks.push({
      name: "harness",
      ready: true,
      detail: "scripted and process harnesses available",
    });
    try {
      await execute("gh", ["auth", "status"]);
      checks.push({ name: "github", ready: true, detail: "GitHub CLI authenticated" });
    } catch {
      checks.push({ name: "github", ready: false, detail: "Run gh auth login" });
    }
    checks.push({
      name: "ci",
      ready: true,
      detail: "one-shot GitHub check/review monitor available",
    });
    checks.push({
      name: "deployment",
      ready: Boolean(
        process.env.AGENT_FACTORY_DEPLOY_COMMAND && process.env.AGENT_FACTORY_SMOKE_COMMAND,
      ),
      detail:
        process.env.AGENT_FACTORY_DEPLOY_COMMAND && process.env.AGENT_FACTORY_SMOKE_COMMAND
          ? "deployment and smoke commands configured"
          : "set AGENT_FACTORY_DEPLOY_COMMAND and AGENT_FACTORY_SMOKE_COMMAND as JSON arrays",
    });
    return { ready: checks.every((check) => check.ready), checks };
  }

  close(): void {
    this.repositories.close();
  }

  private releaseLifecycle(run: WorkflowRun): ReleaseLifecycle {
    if (!process.env.AGENT_FACTORY_DEPLOY_COMMAND || !process.env.AGENT_FACTORY_SMOKE_COMMAND)
      throw unavailable(
        "Set AGENT_FACTORY_DEPLOY_COMMAND and AGENT_FACTORY_SMOKE_COMMAND to JSON command arrays",
      );
    const deployment = new CommandDeploymentProvider(this.commands, {
      workspaceRoot: run.workspace?.root ?? this.root,
      stateRoot: resolve(this.root, ".agent-factory/deployments"),
      deployCommandId: "deploy",
      ...(process.env.AGENT_FACTORY_ROLLBACK_COMMAND ? { rollbackCommandId: "rollback" } : {}),
    });
    return new ReleaseLifecycle(
      this.repositories,
      new GhCliGitHubProvider(),
      deployment,
      this.commands,
    );
  }

  private async cleanupWorkspace(run: WorkflowRun): Promise<void> {
    if (!run.workspace) return;
    const manager = new GitWorkspaceManager({
      repositoryRoot: this.root,
      worktreeRoot: join(dirname(this.root), `.${basename(this.root)}-worktrees`),
    });
    await manager.cleanup(run.id);
  }
}

function createScriptedHarness(): ScriptedHarnessAdapter {
  let revision = 0;
  return new ScriptedHarnessAdapter({
    planning: ({ runId }) =>
      completed(
        runId,
        localArtifact("implementation-plan", "planner", "initial", {
          summary: "Implement requested change",
          steps: ["change", "test", "review"],
          acceptanceCriteria: ["all configured checks pass"],
          risks: ["stale verification evidence"],
          verificationStrategy: ["run deterministic checks and independent reviewers"],
        }),
      ),
    construction: ({ runId, task }) => {
      revision++;
      const remediating = task.inputs.some((input) => input.type === "remediation-request");
      const nextRevision = remediating
        ? `${task.workspace.revision}-remediated-${revision}`
        : `revision-${revision}`;
      return completed(
        runId,
        localArtifact("source-change", "constructor", nextRevision, {
          revision: nextRevision,
          changedPaths: ["src/example.ts"],
          changeKind: "source",
        }),
      );
    },
    test: ({ runId, task }) =>
      completed(
        runId,
        localArtifact("test-report", "tester", task.workspace.revision, {
          revision: task.workspace.revision,
          passed: true,
          tests: 3,
        }),
      ),
    security: ({ runId, task }) =>
      completed(
        runId,
        localArtifact("security-review", "security-reviewer", task.workspace.revision, {
          revision: task.workspace.revision,
          approved: true,
          findings: [],
        }),
      ),
    qa: ({ runId, task }) =>
      completed(
        runId,
        localArtifact("qa-report", "qa-reviewer", task.workspace.revision, {
          revision: task.workspace.revision,
          passed: true,
          findings: [],
        }),
      ),
    "code-review": ({ runId, task }, attempt) =>
      completed(
        runId,
        localArtifact("code-review", "code-reviewer", task.workspace.revision, {
          revision: task.workspace.revision,
          approved: attempt > 1 || task.workspace.revision.includes("remediated"),
          findings:
            attempt > 1 || task.workspace.revision.includes("remediated")
              ? []
              : [
                  {
                    id: "finding-missing-edge-case",
                    fingerprint: "missing-edge-case",
                    severity: "medium",
                    title: "Edge case",
                    description: "Handle edge case",
                    evidence: "The initial scripted revision omits the edge case",
                    sourceLocation: { path: "src/example.ts", line: 1 },
                    revision: task.workspace.revision,
                    resolved: false,
                  },
                ],
        }),
      ),
  });
}

function localArtifact(
  type: string,
  agent: string,
  sourceRevision: string,
  content: unknown,
): ArtifactInstance {
  return {
    id: `artifact-${randomUUID()}`,
    type,
    version: "v1",
    producingStageId: agent,
    producer: { kind: "agent", id: agent },
    createdAt: new Date().toISOString(),
    inputArtifactIds: [],
    validation: { valid: true, errors: [] },
    content,
    sourceRevision,
  };
}

function completed(runId: string, created: ArtifactInstance): AgentEvent[] {
  const timestamp = new Date().toISOString();
  return [
    { type: "agent.started", runId, agentId: created.producer.id, timestamp },
    { type: "artifact.created", runId, artifactId: created.id, timestamp },
    {
      type: "agent.completed",
      runId,
      result: { status: "succeeded", summary: "script completed", artifact: created },
      timestamp,
    },
  ];
}

function unavailable(message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = "UNAVAILABLE";
  return error;
}

function configuredCommand(id: string, environmentName: string): AllowedCommand | undefined {
  const raw = process.env[environmentName];
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${environmentName} must be a JSON array of executable and arguments`);
  }
  if (!Array.isArray(value) || !value.length || !value.every((part) => typeof part === "string"))
    throw new Error(`${environmentName} must be a non-empty JSON string array`);
  const [executable, ...arguments_] = value;
  return { id, executable: executable!, arguments: arguments_ };
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const databaseIndex = raw.findIndex((argument) => argument === "--database" || argument === "-d");
  let database = ".agent-factory/factory.db";
  if (databaseIndex >= 0) {
    database = raw[databaseIndex + 1] ?? database;
    raw.splice(databaseIndex, 2);
  }
  const root = resolve(".");
  const backend = await LocalOperatorBackend.create(root, resolve(root, database));
  try {
    const code = await runCli(raw, backend, {
      writeOut: (line) => console.log(line),
      writeError: (line) => console.error(line),
    });
    process.exitCode = code;
  } finally {
    backend.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
