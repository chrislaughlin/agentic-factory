import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { validateArtifactContent } from "./artifacts.js";
import {
  isTerminalWorkflowStatus,
  type ApprovalRequest,
  type ArtifactInstance,
  type WorkflowRun,
} from "./domain.js";
import { MergeResultSchema, type GitHubProvider } from "./github.js";
import type { CommandEvidence, DeterministicCommandRunner } from "./infrastructure.js";
import type { FactoryRepositories } from "./repositories.js";

export interface DeploymentSnapshot {
  id: string;
  environment: string;
  revision: string;
  state: "pending" | "running" | "succeeded" | "failed" | "rolled-back";
  logs: string[];
}

const DeploymentSnapshotSchema = z.object({
  id: z.string().min(1),
  environment: z.string().min(1),
  revision: z.string().min(1),
  state: z.enum(["pending", "running", "succeeded", "failed", "rolled-back"]),
  logs: z.array(z.string()),
});

const DeploymentObservationSchema = z.object({
  cursor: z.string(),
  deployment: DeploymentSnapshotSchema,
});

const DeployCommandOutputSchema = z.object({
  revision: z.string().min(1),
  deploymentId: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/u)
    .optional(),
});

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
    if (run.status !== "waiting-review")
      throw new Error(`Workflow ${run.id} has not passed local, CI, and review gates`);
    const artifacts = await this.repositories.artifacts.list(run.id);
    const supplied = evidenceArtifactIds.map((id) => {
      const candidate = artifacts.find((artifact) => artifact.id === id);
      if (!candidate) throw new Error(`Final approval evidence does not exist: ${id}`);
      if (!candidate.validation.valid) throw new Error(`Final approval evidence is invalid: ${id}`);
      return candidate;
    });
    const pullRequests = artifacts.filter(
      (artifact) =>
        artifact.type === "pull-request" &&
        artifact.validation.valid &&
        (artifact.content as { headRevision?: string }).headRevision === run.revision,
    );
    const currentCi = currentArtifacts(artifacts, "ci-result", run.revision);
    const currentReviews = currentArtifacts(artifacts, "review-feedback", run.revision);
    const approved = currentReviews.some(
      (artifact) => (artifact.content as { reviewKind?: string }).reviewKind === "approval",
    );
    const blocked = currentReviews.some((artifact) => {
      const content = artifact.content as {
        reviewKind?: string;
        resolved?: boolean;
        classification?: string;
      };
      return (
        content.classification === "actionable" ||
        content.classification === "reasoning-required" ||
        (!content.resolved &&
          (content.reviewKind === "changes-requested" || content.reviewKind === "inline-thread"))
      );
    });
    if (
      pullRequests.length === 0 ||
      currentCi.length === 0 ||
      !currentCi.every((artifact) => (artifact.content as { passed?: boolean }).passed) ||
      !approved ||
      blocked
    )
      throw new Error(`Workflow ${run.id} has not passed local, CI, and review gates`);
    const suppliedIds = new Set(supplied.map((artifact) => artifact.id));
    const missingEvidence = [...pullRequests, ...currentCi, ...currentReviews]
      .filter((artifact) => !suppliedIds.has(artifact.id))
      .map((artifact) => artifact.id);
    if (missingEvidence.length)
      throw new Error(`Final approval is missing gate evidence: ${missingEvidence.join(", ")}`);
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
    if (options.smokeCommandIds.length === 0)
      throw new Error("At least one post-deployment smoke command is required");
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
    let merge: z.infer<typeof MergeResultSchema>;
    try {
      merge = MergeResultSchema.parse(
        await this.github.mergePullRequest({
          repository: options.repository,
          number: options.pullRequestNumber,
          expectedHeadRevision: approval.revision,
          method: options.mergeMethod,
        }),
      );
      if (merge.method !== options.mergeMethod)
        throw new Error(`Merge provider used ${merge.method}, expected ${options.mergeMethod}`);
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
    let deployment: DeploymentSnapshot;
    try {
      deployment = DeploymentSnapshotSchema.parse(
        await this.deployments.start({
          workflowRunId: run.id,
          revision: merge.mergeRevision,
          environment: options.environment,
        }),
      );
    } catch (error) {
      run.status = "escalated";
      run.escalationReason = `Deployment failed to start safely: ${error instanceof Error ? error.message : String(error)}`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
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
    if (isTerminalWorkflowStatus(run.status)) return run;
    const deploymentArtifact = (await this.repositories.artifacts.list(run.id))
      .filter((candidate) => candidate.type === "deployment-result" && candidate.validation.valid)
      .at(-1);
    if (!deploymentArtifact) throw new Error(`Workflow ${run.id} has no deployment to observe`);
    const persisted = deploymentArtifact.content as DeploymentSnapshot & {
      smokeCommandIds: string[];
    };
    const scope = `deployment:${persisted.id}`;
    const cursor = await this.repositories.integrationCursors.get(scope);
    let observation: z.infer<typeof DeploymentObservationSchema>;
    try {
      observation = DeploymentObservationSchema.parse(
        await this.deployments.observe(persisted.id, cursor?.cursor),
      );
    } catch (error) {
      run.status = "escalated";
      run.escalationReason = `Deployment observation failed safely: ${error instanceof Error ? error.message : String(error)}`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
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
    try {
      for (const commandId of persisted.smokeCommandIds) {
        evidence.push(
          await this.commands.run(commandId, {
            cwd: run.workspace?.root ?? ".",
            revision: run.revision,
            environment: {
              AGENT_FACTORY_REVISION: run.revision,
              AGENT_FACTORY_DEPLOYMENT_ID: deployment.id,
              AGENT_FACTORY_ENVIRONMENT: deployment.environment,
            },
          }),
        );
      }
    } catch (error) {
      return this.rollbackOrEscalate(run, {
        ...deployment,
        logs: [
          ...deployment.logs,
          `Smoke verification failed to execute: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
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
    let rolledBack: DeploymentSnapshot;
    try {
      rolledBack = DeploymentSnapshotSchema.parse(
        await this.deployments.rollback(deployment.id, deployment.revision),
      );
    } catch (error) {
      run.status = "escalated";
      run.escalationReason = `Rollback failed safely for ${deployment.id}: ${error instanceof Error ? error.message : String(error)}`;
      await this.repositories.workflowRuns.save(run);
      return run;
    }
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
      artifact(
        "deployment-result",
        "deployment",
        deployment.revision,
        { ...deployment, smokeCommandIds },
        `deployment-${deployment.id}`,
      ),
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
      environment: {
        AGENT_FACTORY_REVISION: input.revision,
        AGENT_FACTORY_ENVIRONMENT: input.environment,
        AGENT_FACTORY_WORKFLOW_RUN_ID: input.workflowRunId,
      },
    });
    let attestation: z.infer<typeof DeployCommandOutputSchema> | undefined;
    if (evidence.passed) {
      const lastLine = evidence.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (!lastLine) throw new Error("Deploy command did not attest the deployed revision");
      try {
        attestation = DeployCommandOutputSchema.parse(JSON.parse(lastLine));
      } catch (error) {
        throw new Error(
          `Deploy command returned an invalid revision attestation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const snapshot: DeploymentSnapshot = {
      id: attestation?.deploymentId ?? id,
      environment: input.environment,
      revision: attestation?.revision ?? input.revision,
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
      environment: {
        AGENT_FACTORY_REVISION: revision,
        AGENT_FACTORY_DEPLOYMENT_ID: deploymentId,
        AGENT_FACTORY_ENVIRONMENT: current.environment,
      },
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
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(deploymentId))
      throw new Error(`Unsafe deployment id: ${deploymentId}`);
    return DeploymentSnapshotSchema.parse(
      JSON.parse(await readFile(this.path(deploymentId), "utf8")),
    );
  }

  private path(deploymentId: string): string {
    return join(this.stateRoot, `${deploymentId}.json`);
  }
}

function artifact(
  type: string,
  producerId: string,
  revision: string,
  content: unknown,
  id = `artifact-${type}-${randomUUID()}`,
): ArtifactInstance {
  validateArtifactContent(type, content);
  return {
    id,
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

function currentArtifacts(
  artifacts: ArtifactInstance[],
  type: string,
  revision: string,
): ArtifactInstance[] {
  return artifacts.filter(
    (artifact) =>
      artifact.type === type && artifact.validation.valid && artifact.sourceRevision === revision,
  );
}
