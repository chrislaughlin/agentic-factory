import { randomUUID } from "node:crypto";
import { validateArtifactContent, invalidateArtifacts } from "./artifacts.js";
import {
  AgentEventSchema,
  type AgentDefinition,
  type AgentEvent,
  type AgentResult,
  type ApprovalRequest,
  type ArtifactInstance,
  type Finding,
  type ModelProfile,
  type PermissionSet,
  type SkillDefinition,
  type StageDefinition,
  type StageRun,
  type TaskEnvelope,
  type WorkflowDefinition,
  type WorkflowRun,
} from "./domain.js";
import { assertHarnessCompatibility, type HarnessAdapter } from "./harness.js";
import type { CommandEvidence, DeterministicCommandRunner } from "./infrastructure.js";
import { noOpObservability, type FactoryObservability } from "./observability.js";
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

function restrictPermissions(agent: PermissionSet, stage?: PermissionSet): PermissionSet {
  if (!stage) return agent;
  const filesystemRank = { deny: 0, "read-only": 1, "workspace-write": 2 } as const;
  const filesystem =
    filesystemRank[agent.filesystem] <= filesystemRank[stage.filesystem]
      ? agent.filesystem
      : stage.filesystem;
  const allowedCommands = new Set(stage.commands);
  return {
    filesystem,
    network: agent.network === "allow" && stage.network === "allow" ? "allow" : "deny",
    commands: agent.commands.filter((command) => allowedCommands.has(command)),
  };
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
    private readonly commandRunner?: DeterministicCommandRunner,
    private readonly observability: FactoryObservability = noOpObservability,
  ) {}
  async submit(
    objective: string,
    revision = "initial",
    workspace?: { root: string; branch: string; baseRevision: string },
    requestedId?: string,
  ): Promise<WorkflowRun> {
    const id = requestedId ?? `wf-${randomUUID()}`;
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
      ...(workspace ? { workspace } : {}),
    };
    await this.repositories.workflowRuns.save(run);
    this.observability.scope({ workflowRunId: run.id }).info("workflow.submitted", {
      workflowId: run.workflowId,
      revision: run.revision,
    });
    await this.drive(run);
    return (await this.get(id))!;
  }
  async approve(approvalId: string, approver: string): Promise<WorkflowRun> {
    const approval = await this.repositories.approvals.get(approvalId);
    if (!approval || approval.status !== "pending")
      throw new Error(`Pending approval not found: ${approvalId}`);
    const pendingRun = await this.get(approval.workflowRunId);
    if (!pendingRun) throw new Error("Workflow not found");
    if (approval.revision && approval.revision !== pendingRun.revision)
      throw new Error(
        `Approval ${approvalId} is stale: expected ${approval.revision}, current ${pendingRun.revision}`,
      );
    const decided: ApprovalRequest = {
      ...approval,
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: approver,
    };
    await this.repositories.approvals.save(decided);
    const run = pendingRun;
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
  async reject(approvalId: string, actor: string, reason: string): Promise<WorkflowRun> {
    const approval = await this.repositories.approvals.get(approvalId);
    if (!approval || approval.status !== "pending")
      throw new Error(`Pending approval not found: ${approvalId}`);
    await this.repositories.approvals.save({
      ...approval,
      status: "rejected",
      decidedAt: new Date().toISOString(),
      decidedBy: actor,
      reason,
    });
    const run = await this.get(approval.workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${approval.workflowRunId}`);
    run.status = "cancelled";
    run.escalationReason = `Approval rejected by ${actor}: ${reason}`;
    await this.repositories.workflowRuns.save(run);
    return run;
  }
  async cancel(workflowRunId: string, reason: string): Promise<WorkflowRun> {
    const run = await this.get(workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${workflowRunId}`);
    for (const stage of run.stageRuns.filter((candidate) => candidate.status === "running"))
      await this.harness.cancel(stage.id);
    run.status = "cancelled";
    run.escalationReason = reason;
    await this.repositories.workflowRuns.save(run);
    return run;
  }
  async retry(workflowRunId: string, stageId: string): Promise<WorkflowRun> {
    const run = await this.get(workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${workflowRunId}`);
    const index = run.stageRuns.findIndex((stage) => stage.stageId === stageId);
    if (index < 0) throw new Error(`Stage not found: ${stageId}`);
    for (const stage of run.stageRuns.slice(index)) {
      if (stage.status !== "waiting-approval") stage.status = "pending";
      await this.repositories.stageRuns.save(run.id, stage);
    }
    run.status = "running";
    delete run.escalationReason;
    await this.repositories.workflowRuns.save(run);
    await this.drive(run);
    return (await this.get(run.id))!;
  }
  async resume(workflowRunId: string): Promise<WorkflowRun> {
    const run = await this.get(workflowRunId);
    if (!run) throw new Error(`Workflow not found: ${workflowRunId}`);
    for (const stage of run.stageRuns.filter((candidate) => candidate.status === "running")) {
      stage.status = "pending";
      await this.repositories.stageRuns.save(run.id, stage);
    }
    if (run.status !== "waiting-approval" && !isTerminalStatus(run.status)) {
      run.status = "running";
      await this.repositories.workflowRuns.save(run);
      await this.drive(run);
    }
    return (await this.get(run.id))!;
  }
  private async drive(run: WorkflowRun): Promise<void> {
    while (run.status === "running") {
      const ready = this.readyStages(run);
      if (!ready.length) {
        if (run.stageRuns.every((x) => x.status === "completed")) {
          run.status = this.definition.completionStatus;
          await this.repositories.workflowRuns.save(run);
        }
        return;
      }
      const next = ready[0]!;
      const definition = this.stageDefinition(next);
      if (definition.kind === "approval") {
        const approval: ApprovalRequest = {
          id: `approval-${randomUUID()}`,
          workflowRunId: run.id,
          stageId: definition.id,
          status: "pending",
          kind: definition.id.includes("final") ? "final" : "plan",
          revision: run.revision,
          evidenceArtifactIds: (await this.repositories.artifacts.list(run.id))
            .filter((artifact) => artifact.validation.valid)
            .map((artifact) => artifact.id),
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
      if (definition.kind === "tool") {
        await this.executeToolStage(run, next, definition);
        continue;
      }
      const readyAgents = ready.filter((stage) => this.stageDefinition(stage).kind === "agent");
      const canRunTogether =
        readyAgents.length > 1 &&
        readyAgents.every((stage) => !this.isWritable(this.stageDefinition(stage)));
      if (canRunTogether) {
        const revision = run.revision;
        await Promise.all(
          readyAgents.map((stage) =>
            this.executeAgentStage(run, stage, this.stageDefinition(stage)),
          ),
        );
        if (run.revision !== revision)
          await this.escalate(run, readyAgents[0]!, "Revision changed during parallel review");
        await this.repositories.workflowRuns.save(run);
      } else {
        await this.executeAgentStage(run, next, definition);
      }
      if (run.status !== "running") return;
    }
  }
  private readyStages(run: WorkflowRun): StageRun[] {
    return run.stageRuns.filter(
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
  private stageDefinition(stage: StageRun): StageDefinition {
    return this.definition.stages.find((candidate) => candidate.id === stage.stageId)!;
  }
  private isWritable(definition: StageDefinition): boolean {
    if (!definition.agentId) return false;
    const agent = this.agents.get(definition.agentId);
    return Boolean(
      agent &&
      restrictPermissions(agent.spec.permissions, definition.permissions).filesystem ===
        "workspace-write",
    );
  }
  private async executeToolStage(
    run: WorkflowRun,
    stage: StageRun,
    definition: StageDefinition,
  ): Promise<void> {
    if (!this.commandRunner)
      return this.escalate(
        run,
        stage,
        `No deterministic command runner configured for ${stage.stageId}`,
      );
    if (!definition.commandIds.length)
      return this.escalate(run, stage, `No commands configured for ${stage.stageId}`);
    stage.status = "running";
    stage.attempts++;
    const telemetry = this.observability.scope({
      workflowRunId: run.id,
      stageId: stage.stageId,
    });
    telemetry.info("stage.started", { kind: "tool", revision: run.revision });
    await this.save(run, stage);
    try {
      const commands: CommandEvidence[] = [];
      for (const commandId of definition.commandIds) {
        commands.push(
          await this.commandRunner.run(commandId, {
            cwd: run.workspace?.root ?? ".",
            revision: run.revision,
          }),
        );
      }
      const artifact = this.createArtifact(
        definition.outputArtifact ?? "command-report",
        stage.stageId,
        "tool",
        "deterministic-command-runner",
        run.revision,
        { revision: run.revision, passed: commands.every((command) => command.passed), commands },
        [],
      );
      await this.repositories.artifacts.save(run.id, artifact);
      stage.artifactIds.push(artifact.id);
      stage.status = "completed";
      await this.save(run, stage);
      telemetry.info("stage.completed", { passed: commands.every((command) => command.passed) });
      telemetry.increment("agent_factory_stage_completed", 1, { kind: "tool" });
    } catch (error) {
      await this.escalate(
        run,
        stage,
        `Deterministic command execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    const permissions = restrictPermissions(agent.spec.permissions, definition.permissions);
    if (permissions.filesystem === "workspace-write") {
      this.writerLease.acquire(stage.id);
    }
    try {
      const telemetry = this.observability.scope({
        workflowRunId: run.id,
        stageId: stage.stageId,
      });
      stage.status = "running";
      stage.attempts++;
      telemetry.info("stage.started", { kind: "agent", revision: run.revision });
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
        permissions,
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
      if (result.status !== "succeeded")
        return await this.escalate(run, stage, `Stage ${stage.stageId} reported a failed result`);
      if (result.artifact.type !== definition.outputArtifact)
        return await this.escalate(
          run,
          stage,
          `Stage ${stage.stageId} produced ${result.artifact.type}; expected ${definition.outputArtifact}`,
        );
      try {
        validateArtifactContent(result.artifact.type, result.artifact.content);
      } catch (error) {
        return await this.escalate(
          run,
          stage,
          `Stage ${stage.stageId} produced an invalid artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        result.artifact.type !== "source-change" &&
        typeof result.artifact.content === "object" &&
        result.artifact.content !== null &&
        "revision" in result.artifact.content &&
        (result.artifact.content as { revision: unknown }).revision !== run.revision
      )
        return await this.escalate(
          run,
          stage,
          `Stage ${stage.stageId} produced evidence for a stale revision`,
        );
      const sourceRevision =
        result.artifact.type === "source-change"
          ? (result.artifact.content as { revision: string }).revision
          : run.revision;
      const artifact: ArtifactInstance = {
        ...result.artifact,
        producingStageId: stage.stageId,
        producer: { kind: "agent", id: agent.metadata.id },
        inputArtifactIds: inputs.map((input) => input.id),
        validation: { valid: true, errors: [] },
        sourceRevision,
      };
      await this.repositories.artifacts.save(run.id, artifact);
      stage.artifactIds.push(artifact.id);
      stage.status = "completed";
      await this.save(run, stage);
      telemetry.info("stage.completed", {
        artifactType: artifact.type,
        revision: artifact.sourceRevision,
      });
      telemetry.increment("agent_factory_stage_completed", 1, { kind: "agent" });
      if (artifact.type === "source-change") {
        const content = artifact.content as {
          revision: string;
          changeKind: "source" | "test" | "documentation";
        };
        run.revision = content.revision;
        const artifacts = await this.repositories.artifacts.list(run.id);
        await this.repositories.artifacts.replace(
          run.id,
          invalidateArtifacts(
            artifacts.filter((x) => x.id !== artifact.id),
            content.changeKind,
            run.revision,
          ).concat(artifact),
        );
      }
    } finally {
      this.writerLease.release(stage.id);
    }
  }
  private async qualityGate(run: WorkflowRun, stage: StageRun): Promise<void> {
    const artifacts = await this.repositories.artifacts.list(run.id);
    stage.attempts++;
    const configuredTypes = this.stageDefinition(stage).inputArtifacts;
    const requiredTypes = configuredTypes.length ? configuredTypes : ["code-review"];
    const selected = new Map<string, ArtifactInstance>();
    const missingArtifactTypes: string[] = [];
    const invalidArtifactTypes: string[] = [];
    for (const type of requiredTypes) {
      const candidates = artifacts.filter((artifact) => artifact.type === type);
      const current = [...candidates]
        .reverse()
        .find((artifact) => artifact.validation.valid && artifact.sourceRevision === run.revision);
      if (current) selected.set(type, current);
      else if (!candidates.length) missingArtifactTypes.push(type);
      else invalidArtifactTypes.push(type);
    }
    const findings = [...selected.values()].flatMap((artifact) => {
      const content = artifact.content as { findings?: Finding[] };
      return content.findings ?? [];
    });
    const blockingFingerprints = findings
      .filter(
        (finding) =>
          !finding.resolved && new Set(["medium", "high", "critical"]).has(finding.severity),
      )
      .map((finding) => finding.fingerprint);
    const failedEvidence: string[] = [];
    const testReport = selected.get("test-report")?.content as { passed?: boolean } | undefined;
    const commandReport = selected.get("command-report")?.content as
      { passed?: boolean; commands?: CommandEvidence[] } | undefined;
    const securityReview = selected.get("security-review")?.content as
      { approved?: boolean } | undefined;
    const qaReport = selected.get("qa-report")?.content as { passed?: boolean } | undefined;
    const codeReview = selected.get("code-review")?.content as { approved?: boolean } | undefined;
    if (testReport && !testReport.passed) failedEvidence.push("test-report-failed");
    if (commandReport && !commandReport.passed)
      failedEvidence.push(
        ...(commandReport.commands ?? [])
          .filter((command) => !command.passed)
          .map((command) => `command-${command.commandId}-failed`),
      );
    if (securityReview && !securityReview.approved) failedEvidence.push("security-review-failed");
    if (qaReport && !qaReport.passed) failedEvidence.push("qa-report-failed");
    if (codeReview && !codeReview.approved) failedEvidence.push("code-review-failed");
    blockingFingerprints.push(...failedEvidence);
    const passed =
      !missingArtifactTypes.length && !invalidArtifactTypes.length && !blockingFingerprints.length;
    const gateArtifact = this.createArtifact(
      "quality-gate",
      stage.stageId,
      "tool",
      "quality-gate",
      run.revision,
      {
        revision: run.revision,
        passed,
        missingArtifactTypes,
        invalidArtifactTypes,
        blockingFingerprints: [...new Set(blockingFingerprints)],
      },
      [...selected.values()].map((artifact) => artifact.id),
    );
    await this.repositories.artifacts.save(run.id, gateArtifact);
    stage.artifactIds.push(gateArtifact.id);
    if (passed) {
      stage.status = "completed";
      await this.save(run, stage);
      const currentArtifacts = await this.repositories.artifacts.list(run.id);
      const allFindings = currentArtifacts.flatMap((artifact) => {
        const content = artifact.content as { findings?: Finding[] };
        return content.findings ?? [];
      });
      const commands = currentArtifacts.flatMap((artifact) =>
        artifact.type === "command-report"
          ? ((artifact.content as { commands: CommandEvidence[] }).commands ?? [])
          : [],
      );
      const report = this.createArtifact(
        "final-report",
        stage.stageId,
        "tool",
        "workflow-engine",
        run.revision,
        {
          branch: run.workspace?.branch ?? "unassigned",
          worktree: run.workspace?.root ?? ".",
          revision: run.revision,
          artifactIds: currentArtifacts.map((artifact) => artifact.id),
          findings: allFindings,
          commands,
          retries: { remediation: run.remediationAttempts },
          outcome: this.definition.completionStatus,
        },
        [gateArtifact.id],
      );
      await this.repositories.artifacts.save(run.id, report);
      stage.artifactIds.push(report.id);
      await this.save(run, stage);
      return;
    }
    run.remediationAttempts++;
    if (run.remediationAttempts > this.definition.policy.maximumTotalRemediationAttempts)
      return await this.escalate(run, stage, "Remediation budget exceeded");
    const syntheticFindings: Finding[] = [
      ...missingArtifactTypes.map((type) =>
        this.gateFinding(
          run.revision,
          `missing-${type}`,
          `Missing ${type}`,
          "Required evidence is absent",
        ),
      ),
      ...invalidArtifactTypes.map((type) =>
        this.gateFinding(
          run.revision,
          `invalid-${type}`,
          `Invalid ${type}`,
          "Evidence is invalid or bound to a stale revision",
        ),
      ),
      ...failedEvidence.map((fingerprint) =>
        this.gateFinding(run.revision, fingerprint, "Quality check failed", fingerprint),
      ),
    ];
    const remediationFindings = [...findings, ...syntheticFindings];
    const fingerprints = [
      ...new Set([
        ...blockingFingerprints,
        ...missingArtifactTypes.map((type) => `missing-${type}`),
        ...invalidArtifactTypes.map((type) => `invalid-${type}`),
      ]),
    ];
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
          revision: run.revision,
          findings: remediationFindings,
          findingFingerprints: fingerprints.length ? fingerprints : ["review-failed"],
          guidance: "Construction agent must address every blocking quality-gate finding",
        },
        [gateArtifact.id],
      ),
    );
    const constructionIndex = this.definition.stages.findIndex(
      (definition) => definition.id === "construction",
    );
    const gateIndex = this.definition.stages.findIndex(
      (definition) => definition.id === stage.stageId,
    );
    const rerunIds = new Set(
      this.definition.stages
        .slice(constructionIndex, gateIndex + 1)
        .filter((definition) => definition.kind !== "approval")
        .map((definition) => definition.id),
    );
    const rerunStages = run.stageRuns.filter((candidate) => rerunIds.has(candidate.stageId));
    for (const rerun of rerunStages) {
      rerun.status = "pending";
      await this.save(run, rerun);
    }
  }
  private gateFinding(
    revision: string,
    fingerprint: string,
    title: string,
    description: string,
  ): Finding {
    return {
      id: `finding-${randomUUID()}`,
      severity: "high",
      title,
      description,
      evidence: description,
      sourceLocation: { path: "workflow:quality-gate" },
      revision,
      fingerprint,
      resolved: false,
    };
  }
  private async escalate(run: WorkflowRun, stage: StageRun, reason: string): Promise<void> {
    stage.status = "failed";
    run.status = "escalated";
    run.escalationReason = reason;
    const telemetry = this.observability.scope({
      workflowRunId: run.id,
      stageId: stage.stageId,
    });
    telemetry.error("workflow.escalated", { reason });
    telemetry.increment("agent_factory_workflow_escalated");
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

function isTerminalStatus(status: WorkflowRun["status"]): boolean {
  return new Set(["completed", "rolled-back", "failed", "escalated", "cancelled"]).has(status);
}
