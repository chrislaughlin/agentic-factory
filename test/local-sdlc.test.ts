import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  AgentDefinitionSchema,
  ArtifactInstanceSchema,
  ModelProfileSchema,
  SkillDefinitionSchema,
  WorkflowDefinitionSchema,
  type AgentEvent,
  type HarnessCapabilities,
} from "../src/domain.js";
import {
  ProcessHarnessAdapter,
  type HarnessAdapter,
  type HarnessRunInput,
} from "../src/harness.js";
import {
  CommandNotAllowedError,
  DeterministicCommandRunner,
  GitWorkspaceManager,
  WorkspaceLockedError,
} from "../src/infrastructure.js";
import { InMemoryRepositories } from "../src/repositories.js";
import { WorkflowEngine } from "../src/workflow.js";

const execute = promisify(execFile);

const agent = AgentDefinitionSchema.parse({
  apiVersion: "agent-factory.dev/v1alpha1",
  kind: "Agent",
  metadata: { id: "planner", displayName: "Planner", version: "1" },
  spec: {
    description: "Plan work",
    instructions: { file: "planner.md" },
    capabilities: { skills: ["planning"], tools: [] },
    permissions: { filesystem: "read-only", network: "deny", commands: [] },
    model: { profile: "balanced" },
    execution: { maxTurns: 3, timeoutSeconds: 10 },
    output: { schema: "implementation-plan/v1" },
  },
});
const skill = SkillDefinitionSchema.parse({
  name: "planning",
  version: "1",
  description: "Plan",
  triggers: ["work"],
  inputs: [],
  outputs: ["implementation-plan/v1"],
  instructions: "Plan the work",
});
const profile = ModelProfileSchema.parse({
  id: "balanced",
  providers: { process: { model: "local-process" } },
});

const scriptedProfile = ModelProfileSchema.parse({
  id: "balanced",
  providers: { concurrent: { model: "deterministic" } },
});

class ConcurrentReviewHarness implements HarnessAdapter {
  readonly id = "concurrent";
  private readonly invocations = new Map<string, number>();
  private activeReviewers = 0;
  maximumActiveReviewers = 0;

  async inspectCapabilities(): Promise<HarnessCapabilities> {
    return {
      subagents: true,
      nestedSubagents: false,
      skills: true,
      mcp: false,
      structuredOutput: true,
      backgroundExecution: true,
      nativeWorktrees: true,
    };
  }

  async materialize() {
    return { harnessId: this.id, files: [], model: "deterministic" };
  }

  async *run(input: HarnessRunInput): AsyncIterable<AgentEvent> {
    const stage = input.task.stageId;
    const attempt = (this.invocations.get(stage) ?? 0) + 1;
    this.invocations.set(stage, attempt);
    const isReviewer = new Set(["security", "qa", "code-review"]).has(stage);
    if (isReviewer) {
      this.activeReviewers++;
      this.maximumActiveReviewers = Math.max(this.maximumActiveReviewers, this.activeReviewers);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const timestamp = new Date().toISOString();
    const revision =
      stage === "construction" ? `revision-${attempt}` : input.task.workspace.revision;
    const content: Record<string, unknown> =
      stage === "planning"
        ? {
            summary: "Implement the accepted request",
            steps: ["construct", "test", "review"],
            acceptanceCriteria: ["all deterministic and independent checks pass"],
            risks: ["stale review evidence"],
            verificationStrategy: ["run configured checks and independent reviewers"],
          }
        : stage === "construction"
          ? { revision, changedPaths: ["src/change.ts"], changeKind: "source" }
          : stage === "test"
            ? { revision, passed: true, tests: 4 }
            : stage === "security"
              ? { revision, approved: true, findings: [] }
              : stage === "qa"
                ? { revision, passed: true, findings: [] }
                : {
                    revision,
                    approved: attempt > 1,
                    findings:
                      attempt > 1
                        ? []
                        : [
                            {
                              id: "finding-edge",
                              severity: "high",
                              title: "Missing edge case",
                              description: "Handle the boundary condition",
                              evidence: "The first revision omits the boundary",
                              sourceLocation: { path: "src/change.ts", line: 1 },
                              revision,
                              fingerprint: "edge-case",
                              resolved: false,
                            },
                          ],
                  };
    const type =
      stage === "planning"
        ? "implementation-plan"
        : stage === "construction"
          ? "source-change"
          : stage === "test"
            ? "test-report"
            : stage === "security"
              ? "security-review"
              : stage === "qa"
                ? "qa-report"
                : "code-review";
    const created = ArtifactInstanceSchema.parse({
      id: `artifact-${stage}-${attempt}`,
      type,
      version: "v1",
      producingStageId: stage,
      producer: { kind: "agent", id: input.task.agentId },
      createdAt: timestamp,
      inputArtifactIds: [],
      validation: { valid: true, errors: [] },
      content,
      sourceRevision: revision,
    });
    yield { type: "agent.started", runId: input.runId, agentId: input.task.agentId, timestamp };
    yield {
      type: "agent.completed",
      runId: input.runId,
      result: { status: "succeeded", summary: `${stage} complete`, artifact: created },
      timestamp,
    };
    if (isReviewer) this.activeReviewers--;
  }

  async cancel() {}
}

const workflowAgent = (id: string, write = false) =>
  AgentDefinitionSchema.parse({
    ...agent,
    metadata: { id, displayName: id, version: "1" },
    spec: {
      ...agent.spec,
      permissions: {
        filesystem: write ? "workspace-write" : "read-only",
        network: "deny",
        commands: [],
      },
    },
  });

describe("real local SDLC", () => {
  it("runs a real process harness through the typed task/event boundary", async () => {
    const script = `
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => body += chunk);
      process.stdin.on("end", () => {
        const input = JSON.parse(body);
        const timestamp = new Date().toISOString();
        const artifact = {
          id: "artifact-plan", type: "implementation-plan", version: "v1",
          producingStageId: input.task.stageId,
          producer: { kind: "agent", id: input.task.agentId },
          createdAt: timestamp, inputArtifactIds: [],
          validation: { valid: true, errors: [] },
          sourceRevision: input.task.workspace.revision,
          content: {
            summary: "Plan the request", steps: ["implement"],
            acceptanceCriteria: ["validation passes"], risks: ["regression"],
            verificationStrategy: ["run validation"]
          }
        };
        console.log(JSON.stringify({ type: "agent.started", runId: input.runId, agentId: input.task.agentId, timestamp }));
        console.log(JSON.stringify({ type: "agent.completed", runId: input.runId, result: { status: "succeeded", summary: "planned", artifact }, timestamp }));
      });
    `;
    const harness = new ProcessHarnessAdapter({
      executable: process.execPath,
      arguments: ["-e", script],
    });
    const config = await harness.materialize({
      agent,
      skills: [skill],
      modelProfile: profile,
      destination: ".",
    });
    const received = [];
    for await (const event of harness.run({
      runId: "stage-planning",
      config,
      task: {
        taskId: "task-1",
        workflowRunId: "workflow-1",
        stageId: "planning",
        agentId: "planner",
        objective: "Ship the feature",
        requiredSkills: ["planning"],
        optionalSkills: [],
        workspace: { root: ".", revision: "abc123" },
        inputs: [],
        expectedOutput: { type: "implementation-plan", version: "v1" },
        permissions: { filesystem: "read-only", network: "deny", commands: [] },
        metadata: {},
      },
    }))
      received.push(event);

    expect(received.map((event) => event.type)).toEqual(["agent.started", "agent.completed"]);
    expect(received[1]).toMatchObject({
      result: { artifact: { content: { risks: ["regression"] } } },
    });
  });

  it("executes only configured deterministic commands and redacts sensitive output", async () => {
    const runner = new DeterministicCommandRunner({
      commands: [
        {
          id: "verify",
          executable: process.execPath,
          arguments: ["-e", "console.log(process.env.TEST_TOKEN); console.error('checked')"],
        },
      ],
      environment: { TEST_TOKEN: "top-secret" },
    });

    const result = await runner.run("verify", { cwd: ".", revision: "abc123" });

    expect(result).toMatchObject({
      commandId: "verify",
      revision: "abc123",
      exitCode: 0,
      passed: true,
      stdout: "[REDACTED]\n",
      stderr: "checked\n",
      timedOut: false,
    });
    await expect(
      runner.run("unconfigured", { cwd: ".", revision: "abc123" }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
  });

  it("creates an isolated branch worktree under an exclusive durable lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-repo-"));
    const worktrees = await mkdtemp(join(tmpdir(), "factory-worktrees-"));
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "factory@example.test"], { cwd: root });
    await execute("git", ["config", "user.name", "Agent Factory"], { cwd: root });
    await writeFile(join(root, "README.md"), "baseline\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "baseline"], { cwd: root });
    const manager = new GitWorkspaceManager({ repositoryRoot: root, worktreeRoot: worktrees });

    const workspace = await manager.prepare({ runId: "workflow-123", baseBranch: "main" });

    expect(workspace.root).not.toBe(root);
    expect(workspace.branch).toBe("agent-factory/workflow-123");
    await expect(readFile(join(workspace.root, "README.md"), "utf8")).resolves.toBe("baseline\n");
    await expect(
      manager.prepare({ runId: "workflow-456", baseBranch: "main" }),
    ).rejects.toBeInstanceOf(WorkspaceLockedError);
    await manager.cleanup("workflow-123");
    await expect(
      manager.prepare({ runId: "workflow-456", baseBranch: "main" }),
    ).resolves.toMatchObject({
      branch: "agent-factory/workflow-456",
    });
    await manager.cleanup("workflow-456");
  });

  it("reaches locally verified through deterministic gates, concurrent review, and remediation", async () => {
    const repositories = new InMemoryRepositories();
    const workspaceRoot = await mkdtemp(join(tmpdir(), "factory-local-sdlc-"));
    const harness = new ConcurrentReviewHarness();
    const definition = WorkflowDefinitionSchema.parse({
      apiVersion: "agent-factory.dev/v1alpha1",
      kind: "Workflow",
      metadata: { id: "complete-local-sdlc", version: "1" },
      completionStatus: "locally-verified",
      policy: { maximumAttemptsPerStage: 3, maximumTotalRemediationAttempts: 2 },
      stages: [
        {
          id: "planning",
          kind: "agent",
          agentId: "planner",
          outputArtifact: "implementation-plan",
        },
        { id: "plan-approval", kind: "approval", dependsOn: ["planning"] },
        {
          id: "construction",
          kind: "agent",
          agentId: "constructor",
          dependsOn: ["plan-approval"],
          outputArtifact: "source-change",
        },
        {
          id: "test",
          kind: "agent",
          agentId: "tester",
          dependsOn: ["construction"],
          outputArtifact: "test-report",
        },
        {
          id: "deterministic-checks",
          kind: "tool",
          dependsOn: ["test"],
          outputArtifact: "command-report",
          commandIds: ["test", "typecheck", "lint", "build", "security"],
        },
        {
          id: "security",
          kind: "agent",
          agentId: "security-reviewer",
          dependsOn: ["deterministic-checks"],
          outputArtifact: "security-review",
        },
        {
          id: "qa",
          kind: "agent",
          agentId: "qa-reviewer",
          dependsOn: ["deterministic-checks"],
          outputArtifact: "qa-report",
        },
        {
          id: "code-review",
          kind: "agent",
          agentId: "code-reviewer",
          dependsOn: ["deterministic-checks"],
          outputArtifact: "code-review",
        },
        {
          id: "quality-gate",
          kind: "quality-gate",
          dependsOn: ["security", "qa", "code-review"],
          inputArtifacts: [
            "test-report",
            "command-report",
            "security-review",
            "qa-report",
            "code-review",
          ],
        },
      ],
    });
    const pass = { executable: process.execPath, arguments: ["-e", "process.exit(0)"] };
    const commands = new DeterministicCommandRunner({
      commands: ["test", "typecheck", "lint", "build", "security"].map((id) => ({ id, ...pass })),
    });
    const agents = [
      workflowAgent("planner"),
      workflowAgent("constructor", true),
      workflowAgent("tester", true),
      workflowAgent("security-reviewer"),
      workflowAgent("qa-reviewer"),
      workflowAgent("code-reviewer"),
    ];
    const engine = new WorkflowEngine(
      repositories,
      harness,
      definition,
      new Map(agents.map((value) => [value.metadata.id, value])),
      new Map([[skill.name, skill]]),
      new Map([[scriptedProfile.id, scriptedProfile]]),
      commands,
    );

    const paused = await engine.submit("Implement the complete local workflow", "base-revision", {
      root: workspaceRoot,
      branch: "agent-factory/workflow",
      baseRevision: "base-revision",
    });
    expect(paused.status).toBe("waiting-approval");
    const approval = (await repositories.approvals.list(paused.id))[0]!;
    const completed = await engine.approve(approval.id, "operator");
    const artifacts = await repositories.artifacts.list(completed.id);

    expect(completed.status, completed.escalationReason).toBe("locally-verified");
    expect(completed.remediationAttempts).toBe(1);
    expect(harness.maximumActiveReviewers).toBe(3);
    expect(
      artifacts.filter((value) => value.type === "command-report" && value.validation.valid),
    ).toHaveLength(1);
    expect(artifacts.some((value) => value.type === "code-review" && !value.validation.valid)).toBe(
      true,
    );
    expect(artifacts.at(-1)).toMatchObject({
      type: "final-report",
      content: {
        branch: "agent-factory/workflow",
        revision: "revision-2",
        outcome: "locally-verified",
        retries: { remediation: 1 },
      },
    });
  });
});
