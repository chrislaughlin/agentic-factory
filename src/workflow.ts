import { randomUUID } from "node:crypto";
import { validateArtifactContent, invalidateArtifacts } from "./artifacts.js";
import {
  AgentEventSchema,
  type AgentDefinition,
  type AgentEvent,
  type AgentResult,
  type ApprovalRequest,
  type ArtifactInstance,
  type ModelProfile,
  type SkillDefinition,
  type StageDefinition,
  type StageRun,
  type TaskEnvelope,
  type WorkflowDefinition,
  type WorkflowRun,
} from "./domain.js";
import { assertHarnessCompatibility, type HarnessAdapter } from "./harness.js";
import type { FactoryRepositories } from "./repositories.js";

export class ConcurrentWriterError extends Error {
  readonly code = "CONCURRENT_WRITER";
}
export class WorkflowEscalatedError extends Error {
  readonly code = "WORKFLOW_ESCALATED";
}

export class WorkspaceWriterLease {
  private holder: string | undefined;
  acquire(stageRunId: string): void {
    if (this.holder && this.holder !== stageRunId)
      throw new ConcurrentWriterError(`Writer ${this.holder} already active`);
    this.holder = stageRunId;
  }
  release(stageRunId: string): void {
    if (this.holder === stageRunId) this.holder = undefined;
  }
}

export class WorkflowEngine {
  private readonly writerLease = new WorkspaceWriterLease();
  constructor(
    private readonly repositories: FactoryRepositories,
    private readonly harness: HarnessAdapter,
    private readonly definition: WorkflowDefinition,
    private readonly agents: Map<string, AgentDefinition>,
    private readonly skills: Map<string, SkillDefinition>,
    private readonly profiles: Map<string, ModelProfile>,
  ) {}
  async submit(objective: string, revision = "initial"): Promise<WorkflowRun> {
    const id = `wf-${randomUUID()}`;
    const stageRuns = this.definition.stages.map((stage) => ({
      id: `${id}-${stage.id}`,
      stageId: stage.id,
      status: "pending" as const,
      attempts: 0,
      artifactIds: [],
    }));
    const run: WorkflowRun = {
      id,
      workflowId: this.definition.metadata.id,
      objective,
      status: "running",
      revision,
      stageRuns,
      remediationAttempts: 0,
    };
    await this.repositories.workflowRuns.save(run);
    await this.drive(run);
    return (await this.get(id))!;
  }
  async approve(approvalId: string, approver: string): Promise<WorkflowRun> {
    const approval = await this.repositories.approvals.get(approvalId);
    if (!approval || approval.status !== "pending")
      throw new Error(`Pending approval not found: ${approvalId}`);
    const decided: ApprovalRequest = {
      ...approval,
      status: "approved",
      decidedAt: new Date().toISOString(),
    };
    await this.repositories.approvals.save(decided);
    const run = await this.get(approval.workflowRunId);
    if (!run) throw new Error("Workflow not found");
    const stage = run.stageRuns.find((x) => x.stageId === approval.stageId)!;
    stage.status = "completed";
    run.status = "running";
    await this.repositories.artifacts.save(
      run.id,
      this.createArtifact(
        "approval",
        stage.stageId,
        "human",
        approver,
        run.revision,
        { approved: true, approver },
        [],
      ),
    );
    await this.save(run, stage);
    await this.drive(run);
    return (await this.get(run.id))!;
  }
  async get(id: string) {
    return this.repositories.workflowRuns.get(id);
  }
  private async drive(run: WorkflowRun): Promise<void> {
    while (run.status === "running") {
      const next = this.nextReady(run);
      if (!next) {
        if (run.stageRuns.every((x) => x.status === "completed")) {
          run.status = "completed";
          await this.repositories.workflowRuns.save(run);
        }
        return;
      }
      const definition = this.definition.stages.find((x) => x.id === next.stageId)!;
      if (definition.kind === "approval") {
        const approval: ApprovalRequest = {
          id: `approval-${randomUUID()}`,
          workflowRunId: run.id,
          stageId: definition.id,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        next.status = "waiting-approval";
        run.status = "waiting-approval";
        await this.repositories.approvals.save(approval);
        await this.save(run, next);
        await this.event(run.id, {
          type: "approval.requested",
          runId: next.id,
          approvalId: approval.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (definition.kind === "quality-gate") {
        await this.qualityGate(run, next);
        continue;
      }
      await this.executeAgentStage(run, next, definition);
      if (run.status !== "running") return;
    }
  }
  private nextReady(run: WorkflowRun): StageRun | undefined {
    return run.stageRuns.find(
      (candidate) =>
        candidate.status === "pending" &&
        this.definition.stages
          .find((x) => x.id === candidate.stageId)!
          .dependsOn.every(
            (dependency) =>
              run.stageRuns.find((x) => x.stageId === dependency)?.status === "completed",
          ),
    );
  }
  private async executeAgentStage(
    run: WorkflowRun,
    stage: StageRun,
    definition: StageDefinition,
  ): Promise<void> {
    if (!definition.agentId) throw new Error(`Agent missing for ${definition.id}`);
    const agent = this.agents.get(definition.agentId);
    if (!agent) throw new Error(`Unknown agent ${definition.agentId}`);
    await assertHarnessCompatibility(this.harness, definition.requiredHarnessCapabilities);
    if (agent.spec.permissions.filesystem === "workspace-write") {
      this.writerLease.acquire(stage.id);
    }
    try {
      stage.status = "running";
      stage.attempts++;
      await this.save(run, stage);
      if (stage.attempts > this.definition.policy.maximumAttemptsPerStage)
        return await this.escalate(run, stage, `Stage ${stage.stageId} exceeded retry limit`);
      const selectedSkills = agent.spec.capabilities.skills
        .map((id) => this.skills.get(id))
        .filter((skill): skill is SkillDefinition => Boolean(skill));
      const profile = this.profiles.get(agent.spec.model.profile);
      if (!profile) throw new Error(`Unknown model profile ${agent.spec.model.profile}`);
      const config = await this.harness.materialize({
        agent,
        skills: selectedSkills,
        modelProfile: profile,
        destination: ".",
      });
      const inputs = (await this.repositories.artifacts.list(run.id)).filter(
        (a) => a.validation.valid && definition.inputArtifacts.includes(a.type),
      );
      const task: TaskEnvelope = {
        taskId: `task-${randomUUID()}`,
        workflowRunId: run.id,
        stageId: stage.stageId,
        agentId: agent.metadata.id,
        objective: run.objective,
        requiredSkills: selectedSkills.map((x) => x.name),
        optionalSkills: [],
        workspace: { root: ".", revision: run.revision },
        inputs: inputs.map((x) => ({ artifactId: x.id, type: x.type, version: x.version })),
        expectedOutput: { type: definition.outputArtifact!, version: "v1" },
        permissions: agent.spec.permissions,
        metadata: {},
      };
      let result: AgentResult | undefined;
      for await (const nativeEvent of this.harness.run({ runId: stage.id, task, config })) {
        const event = AgentEventSchema.parse(nativeEvent);
        await this.repositories.events.append(run.id, event);
        if (event.type === "agent.completed") result = event.result;
        if (event.type === "agent.failed") {
          stage.status = event.error.retryable ? "pending" : "failed";
          await this.save(run, stage);
          if (
            event.error.retryable &&
            stage.attempts < this.definition.policy.maximumAttemptsPerStage
          )
            return;
          return await this.escalate(run, stage, event.error.message);
        }
      }
      if (!result?.artifact)
        return await this.escalate(run, stage, `Stage ${stage.stageId} produced no artifact`);
      validateArtifactContent(result.artifact.type, result.artifact.content);
      await this.repositories.artifacts.save(run.id, result.artifact);
      stage.artifactIds.push(result.artifact.id);
      stage.status = "completed";
      await this.save(run, stage);
      if (result.artifact.type === "source-change") {
        const content = result.artifact.content as {
          revision: string;
          changeKind: "source" | "test" | "documentation";
        };
        run.revision = content.revision;
        const artifacts = await this.repositories.artifacts.list(run.id);
        await this.repositories.artifacts.replace(
          run.id,
          invalidateArtifacts(
            artifacts.filter((x) => x.id !== result!.artifact!.id),
            content.changeKind,
            run.revision,
          ).concat(result.artifact),
        );
      }
    } finally {
      this.writerLease.release(stage.id);
    }
  }
  private async qualityGate(run: WorkflowRun, stage: StageRun): Promise<void> {
    const artifacts = await this.repositories.artifacts.list(run.id);
    const review = [...artifacts]
      .reverse()
      .find(
        (x) => x.type === "code-review" && x.validation.valid && x.sourceRevision === run.revision,
      );
    const passed = Boolean((review?.content as { approved?: boolean } | undefined)?.approved);
    if (passed) {
      stage.status = "completed";
      await this.save(run, stage);
      return;
    }
    run.remediationAttempts++;
    if (run.remediationAttempts > this.definition.policy.maximumTotalRemediationAttempts)
      return await this.escalate(run, stage, "Remediation budget exceeded");
    const construction = run.stageRuns.find((x) => x.stageId === "construction")!;
    const test = run.stageRuns.find((x) => x.stageId === "test")!;
    const codeReview = run.stageRuns.find((x) => x.stageId === "code-review")!;
    const fingerprints = (
      (review?.content as { findings?: Array<{ fingerprint: string }> } | undefined)?.findings ?? []
    ).map((x) => x.fingerprint);
    const prior = artifacts
      .filter((x) => x.type === "remediation-request")
      .flatMap((x) => (x.content as { findingFingerprints: string[] }).findingFingerprints);
    if (fingerprints.some((x) => prior.includes(x)))
      return await this.escalate(run, stage, "The same finding reappeared after remediation");
    await this.repositories.artifacts.save(
      run.id,
      this.createArtifact(
        "remediation-request",
        stage.stageId,
        "tool",
        "quality-gate",
        run.revision,
        {
          findingFingerprints: fingerprints.length ? fingerprints : ["review-failed"],
          guidance: "Construction agent must address review findings",
        },
        review ? [review.id] : [],
      ),
    );
    construction.status = "pending";
    test.status = "pending";
    codeReview.status = "pending";
    stage.status = "pending";
    await Promise.all([
      this.save(run, construction),
      this.save(run, test),
      this.save(run, codeReview),
      this.save(run, stage),
    ]);
  }
  private async escalate(run: WorkflowRun, stage: StageRun, reason: string): Promise<void> {
    stage.status = "failed";
    run.status = "escalated";
    run.escalationReason = reason;
    await this.save(run, stage);
  }
  private createArtifact(
    type: string,
    stage: string,
    producerKind: "agent" | "tool" | "human",
    producerId: string,
    revision: string,
    content: unknown,
    inputs: string[],
  ): ArtifactInstance {
    validateArtifactContent(type, content);
    return {
      id: `artifact-${randomUUID()}`,
      type,
      version: "v1",
      producingStageId: stage,
      producer: { kind: producerKind, id: producerId },
      createdAt: new Date().toISOString(),
      inputArtifactIds: inputs,
      validation: { valid: true, errors: [] },
      content,
      sourceRevision: revision,
    };
  }
  private async save(run: WorkflowRun, stage: StageRun) {
    await this.repositories.stageRuns.save(run.id, stage);
    await this.repositories.workflowRuns.save(run);
  }
  private async event(id: string, event: AgentEvent) {
    await this.repositories.events.append(id, AgentEventSchema.parse(event));
  }
}
