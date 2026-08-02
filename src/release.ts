import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateArtifactContent } from "./artifacts.js";
import type { ApprovalRequest, ArtifactInstance, WorkflowRun } from "./domain.js";
import type { GitHubProvider } from "./github.js";
import type { CommandEvidence, DeterministicCommandRunner } from "./infrastructure.js";
import type { FactoryRepositories } from "./repositories.js";

export interface DeploymentSnapshot {
  id: string;
  environment: string;
  revision: string;
  state: "pending" | "running" | "succeeded" | "failed" | "rolled-back";
  logs: string[];
}

export interface DeploymentProvider {
  start(input: {
    workflowRunId: string;
    revision: string;
    environment: string;
  }): Promise<DeploymentSnapshot>;
  observe(
    deploymentId: string,
    cursor?: string,
  ): Promise<{ cursor: string; deployment: DeploymentSnapshot }>;
  rollback?(deploymentId: string, revision: string): Promise<DeploymentSnapshot>;
}

export class StaleApprovalError extends Error {
  readonly code = "STALE_APPROVAL";
}

export interface ReleaseOptions {
  repository: string;
  pullRequestNumber: number;
  mergeMethod: "merge" | "squash" | "rebase";
  environment: string;
  smokeCommandIds: string[];
}

export class ReleaseLifecycle {
  constructor(
    private readonly repositories: FactoryRepositories,
    private readonly github: GitHubProvider,
    private readonly deployments: DeploymentProvider,
    private readonly commands: DeterministicCommandRunner,
  ) {}

  async requestFinalApproval(
    workflowRunId: string,
    evidenceArtifactIds: string[],
  ): Promise<ApprovalRequest> {
    const run = await this.requireRun(workflowRunId);
    if (!new Set(["locally-verified", "waiting-review"]).has(run.status))
      throw new Error(`Workflow ${run.id} has not passed local, CI, and review gates`);
    const approval: ApprovalRequest = {
      id: `approval-${randomUUID()}`,
      workflowRunId: run.id,
      stageId: "final-approval",
      kind: "final",
      revision: run.revision,
      evidenceArtifactIds,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.repositories.approvals.save(approval);
    run.status = "waiting-final-approval";
    await this.repositories.workflowRuns.save(run);
    return approval;
  }

  async approveAndDeploy(
    approvalId: string,
    approver: string,
    options: ReleaseOptions,
  ): Promise<WorkflowRun> {
    const approval = await this.repositories.approvals.get(approvalId);
    if (!approval || approval.status !== "pending" || approval.kind !== "final")
      throw new Error(`Pending final approval not found: ${approvalId}`);
    const run = await this.requireRun(approval.workflowRunId);
    if (!approval.revision || approval.revision !== run.revision)
      throw new StaleApprovalError(
        `Approval ${approval.id} is stale: approved ${approval.revision ?? "unknown"}, current ${run.revision}`,
      );
    await this.repositories.approvals.save({
      ...approval,
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: approver,
    });
    run.status = "merging";
    await this.repositories.workflowRuns.save(run);
    let merge: Awaited<ReturnType<GitHubProvider["mergePullRequest"]>>;
    try {
      merge = await this.github.mergePullRequest({
        repository: options.repository,
        number: options.pullRequestNumber,
        expectedHeadRevision: approval.revision,
        method: options.mergeMethod,
      });
    } catch (error) {
      run.status = "escalated";
      run.escalationReason = `Merge failed safely: ${error instanceof Error ? error.message : String(error)}`;
      await this.repositories.workflowRuns.save(run);
      throw error;
    }
    await this.repositories.artifacts.save(
      run.id,
      artifact("merge-result", "merge", merge.mergeRevision, {
        repository: options.repository,
        pullRequestNumber: options.pullRequestNumber,
        headRevision: approval.revision,
        mergeRevision: merge.mergeRevision,
        method: options.mergeMethod,
        actor: merge.actor,
        mergedAt: merge.mergedAt,
      }),
    );
    run.revision = merge.mergeRevision;
    run.status = "deploying";
    await this.repositories.workflowRuns.save(run);
    const deployment = await this.deployments.start({
      workflowRunId: run.id,
      revision: merge.mergeRevision,
      environment: options.environment,
    });
    if (deployment.revision !== merge.mergeRevision) {
      run.status = "escalated";
      run.escalationReason = `Deployment revision ${deployment.revision} does not match merge ${merge.mergeRevision}`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
    await this.saveDeployment(run.id, deployment, options.smokeCommandIds);
    return run;
  }

  async observe(workflowRunId: string): Promise<WorkflowRun> {
    const run = await this.requireRun(workflowRunId);
    if (isTerminal(run.status)) return run;
    const deploymentArtifact = (await this.repositories.artifacts.list(run.id))
      .filter((candidate) => candidate.type === "deployment-result" && candidate.validation.valid)
      .at(-1);
    if (!deploymentArtifact) throw new Error(`Workflow ${run.id} has no deployment to observe`);
    const persisted = deploymentArtifact.content as DeploymentSnapshot & {
      smokeCommandIds: string[];
    };
    const scope = `deployment:${persisted.id}`;
    const cursor = await this.repositories.integrationCursors.get(scope);
    const observation = await this.deployments.observe(persisted.id, cursor?.cursor);
    await this.repositories.integrationCursors.save({
      scope,
      cursor: observation.cursor,
      updatedAt: new Date().toISOString(),
    });
    const deployment = observation.deployment;
    if (deployment.revision !== run.revision) {
      run.status = "escalated";
      run.escalationReason = `Observed deployment revision ${deployment.revision} does not match ${run.revision}`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
    await this.saveDeployment(run.id, deployment, persisted.smokeCommandIds);
    if (deployment.state === "pending" || deployment.state === "running") return run;
    if (deployment.state === "failed") return this.rollbackOrEscalate(run, deployment);
    if (deployment.state === "rolled-back") {
      run.status = "rolled-back";
      await this.repositories.workflowRuns.save(run);
      return run;
    }
    run.status = "verifying";
    await this.repositories.workflowRuns.save(run);
    const evidence: CommandEvidence[] = [];
    for (const commandId of persisted.smokeCommandIds) {
      evidence.push(
        await this.commands.run(commandId, {
          cwd: run.workspace?.root ?? ".",
          revision: run.revision,
        }),
      );
    }
    const passed = evidence.every((command) => command.passed);
    await this.repositories.artifacts.save(
      run.id,
      artifact("post-deployment-verification", "post-deploy", run.revision, {
        deploymentId: deployment.id,
        revision: run.revision,
        passed,
        commands: evidence,
      }),
    );
    if (!passed) return this.rollbackOrEscalate(run, deployment);
    run.status = "completed";
    await this.repositories.workflowRuns.save(run);
    return run;
  }

  private async rollbackOrEscalate(
    run: WorkflowRun,
    deployment: DeploymentSnapshot,
  ): Promise<WorkflowRun> {
    if (!this.deployments.rollback) {
      run.status = "escalated";
      run.escalationReason = `Deployment ${deployment.id} failed and no automatic rollback is configured`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
    const rolledBack = await this.deployments.rollback(deployment.id, deployment.revision);
    await this.repositories.artifacts.save(
      run.id,
      artifact("rollback-result", "rollback", run.revision, {
        deploymentId: deployment.id,
        revision: deployment.revision,
        successful: rolledBack.state === "rolled-back",
        logs: rolledBack.logs,
      }),
    );
    run.status = rolledBack.state === "rolled-back" ? "rolled-back" : "escalated";
    if (run.status === "escalated") run.escalationReason = `Rollback failed for ${deployment.id}`;
    await this.repositories.workflowRuns.save(run);
    return run;
  }

  private async saveDeployment(
    workflowRunId: string,
    deployment: DeploymentSnapshot,
    smokeCommandIds: string[],
  ): Promise<void> {
    await this.repositories.artifacts.save(
      workflowRunId,
      artifact(`deployment-${deployment.id}`, "deployment-result", deployment.revision, {
        ...deployment,
        smokeCommandIds,
      }),
    );
  }

  private async requireRun(id: string): Promise<WorkflowRun> {
    const run = await this.repositories.workflowRuns.get(id);
    if (!run) throw new Error(`Workflow not found: ${id}`);
    return run;
  }
}

/** Initial deployment provider backed by configured, allowlisted local commands and durable files. */
export class CommandDeploymentProvider implements DeploymentProvider {
  private readonly workspaceRoot: string;
  private readonly stateRoot: string;
  private readonly rollbackCommandId: string | undefined;

  constructor(
    private readonly commands: DeterministicCommandRunner,
    options: {
      workspaceRoot: string;
      stateRoot: string;
      deployCommandId: string;
      rollbackCommandId?: string;
    },
  ) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.stateRoot = resolve(options.stateRoot);
    this.deployCommandId = options.deployCommandId;
    this.rollbackCommandId = options.rollbackCommandId;
  }

  private readonly deployCommandId: string;

  async start(input: {
    workflowRunId: string;
    revision: string;
    environment: string;
  }): Promise<DeploymentSnapshot> {
    const id = `deployment-${randomUUID()}`;
    const evidence = await this.commands.run(this.deployCommandId, {
      cwd: this.workspaceRoot,
      revision: input.revision,
    });
    const snapshot: DeploymentSnapshot = {
      id,
      environment: input.environment,
      revision: input.revision,
      state: evidence.passed ? "succeeded" : "failed",
      logs: [evidence.stdout, evidence.stderr].filter(Boolean),
    };
    await this.persist(snapshot);
    return snapshot;
  }

  async observe(deploymentId: string): Promise<{ cursor: string; deployment: DeploymentSnapshot }> {
    const deployment = await this.load(deploymentId);
    return { cursor: `${deployment.id}:${deployment.state}`, deployment };
  }

  async rollback(deploymentId: string, revision: string): Promise<DeploymentSnapshot> {
    const current = await this.load(deploymentId);
    if (!this.rollbackCommandId)
      return {
        ...current,
        state: "failed",
        logs: [...current.logs, "No rollback command configured"],
      };
    const evidence = await this.commands.run(this.rollbackCommandId, {
      cwd: this.workspaceRoot,
      revision,
    });
    const snapshot: DeploymentSnapshot = {
      ...current,
      state: evidence.passed ? "rolled-back" : "failed",
      logs: [...current.logs, evidence.stdout, evidence.stderr].filter(Boolean),
    };
    await this.persist(snapshot);
    return snapshot;
  }

  private async persist(snapshot: DeploymentSnapshot): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true });
    const target = this.path(snapshot.id);
    const temporary = `${target}.tmp-${process.pid}`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, target);
  }

  private async load(deploymentId: string): Promise<DeploymentSnapshot> {
    if (!/^deployment-[a-zA-Z0-9-]+$/u.test(deploymentId))
      throw new Error(`Unsafe deployment id: ${deploymentId}`);
    return JSON.parse(await readFile(this.path(deploymentId), "utf8")) as DeploymentSnapshot;
  }

  private path(deploymentId: string): string {
    return join(this.stateRoot, `${deploymentId}.json`);
  }
}

function artifact(
  idOrType: string,
  producerId: string,
  revision: string,
  content: unknown,
): ArtifactInstance {
  const type = idOrType.startsWith("deployment-") ? "deployment-result" : idOrType;
  validateArtifactContent(type, content);
  return {
    id: idOrType.startsWith("deployment-") ? idOrType : `artifact-${idOrType}-${randomUUID()}`,
    type,
    version: "v1",
    producingStageId: producerId,
    producer: { kind: "tool", id: producerId },
    createdAt: new Date().toISOString(),
    inputArtifactIds: [],
    validation: { valid: true, errors: [] },
    content,
    sourceRevision: revision,
  };
}

function isTerminal(status: WorkflowRun["status"]): boolean {
  return new Set(["completed", "rolled-back", "failed", "escalated", "cancelled"]).has(status);
}
