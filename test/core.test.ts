import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentDefinitionSchema,
  AgentEventSchema,
  ArtifactInstanceSchema,
  ModelProfileSchema,
  SkillDefinitionSchema,
  WorkflowDefinitionSchema,
  type AgentDefinition,
  type AgentEvent,
  type ArtifactInstance,
} from "../src/domain.js";
import { invalidateArtifacts, validateArtifactContent } from "../src/artifacts.js";
import {
  assertHarnessCompatibility,
  CodexHarnessAdapter,
  HarnessCompatibilityError,
  ScriptedHarnessAdapter,
  UnsupportedHarnessOperationError,
} from "../src/harness.js";
import { loadAgent, safeResolve, UnsafePathError } from "../src/loader.js";
import { InMemoryRepositories, SqliteRepositories } from "../src/repositories.js";
import { ConcurrentWriterError, WorkflowEngine, WorkspaceWriterLease } from "../src/workflow.js";

const timestamp = () => new Date().toISOString();
function artifact(
  type: string,
  stage: string,
  revision: string,
  content: unknown,
): ArtifactInstance {
  return ArtifactInstanceSchema.parse({
    id: `a-${stage}-${Math.random()}`,
    type,
    version: "v1",
    producingStageId: stage,
    producer: { kind: "agent", id: stage },
    createdAt: timestamp(),
    inputArtifactIds: [],
    validation: { valid: true, errors: [] },
    content,
    sourceRevision: revision,
  });
}
function events(runId: string, value: ArtifactInstance): AgentEvent[] {
  return [
    AgentEventSchema.parse({
      type: "agent.started",
      runId,
      agentId: value.producer.id,
      timestamp: timestamp(),
    }),
    AgentEventSchema.parse({
      type: "agent.completed",
      runId,
      result: { status: "succeeded", artifact: value, summary: "ok" },
      timestamp: timestamp(),
    }),
  ];
}
function finding(fingerprint: string, revision: string) {
  return {
    id: `finding-${fingerprint}`,
    severity: "medium" as const,
    title: "Review finding",
    description: "A review finding requires remediation",
    evidence: "Observed by the reviewer",
    sourceLocation: { path: "src/x.ts", line: 1 },
    revision,
    fingerprint,
    resolved: false,
  };
}
const agent = (id: string, write = false): AgentDefinition =>
  AgentDefinitionSchema.parse({
    apiVersion: "agent-factory.dev/v1alpha1",
    kind: "Agent",
    metadata: { id, displayName: id, version: "1" },
    spec: {
      description: id,
      instructions: { file: "x" },
      capabilities: { skills: ["basic"], tools: [] },
      permissions: {
        filesystem: write ? "workspace-write" : "read-only",
        network: "deny",
        commands: [],
      },
      model: { profile: "balanced" },
      execution: { maxTurns: 3, timeoutSeconds: 10 },
      output: { schema: "x/v1" },
    },
  });
const skill = SkillDefinitionSchema.parse({
  name: "basic",
  version: "1",
  description: "basic",
  triggers: ["always"],
  inputs: [],
  outputs: ["artifact"],
  instructions: "work",
});
const profile = ModelProfileSchema.parse({
  id: "balanced",
  providers: { scripted: { model: "fake" } },
});
const workflow = WorkflowDefinitionSchema.parse({
  apiVersion: "agent-factory.dev/v1alpha1",
  kind: "Workflow",
  metadata: { id: "slice", version: "1" },
  policy: { maximumAttemptsPerStage: 3, maximumTotalRemediationAttempts: 2 },
  stages: [
    {
      id: "planning",
      kind: "agent",
      agentId: "planner",
      outputArtifact: "implementation-plan",
      requiredHarnessCapabilities: ["structuredOutput"],
    },
    { id: "plan-approval", kind: "approval", dependsOn: ["planning"], outputArtifact: "approval" },
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
      id: "code-review",
      kind: "agent",
      agentId: "reviewer",
      dependsOn: ["test"],
      outputArtifact: "code-review",
    },
    { id: "quality-gate", kind: "quality-gate", dependsOn: ["code-review"] },
  ],
});

describe("validated canonical definitions and protocols", () => {
  it("rejects malformed definitions and events", () => {
    expect(() => AgentDefinitionSchema.parse({ kind: "Agent" })).toThrow();
    expect(() => AgentEventSchema.parse({ type: "made.up" })).toThrow();
  });
  it("rejects duplicate, missing, and cyclic workflow dependencies", () => {
    const definition = (stages: unknown[]) => ({
      apiVersion: "agent-factory.dev/v1alpha1",
      kind: "Workflow",
      metadata: { id: "invalid-graph", version: "1" },
      stages,
    });
    const stage = (id: string, dependsOn: string[] = []) => ({
      id,
      kind: "agent",
      agentId: "planner",
      outputArtifact: "implementation-plan",
      dependsOn,
    });

    expect(() =>
      WorkflowDefinitionSchema.parse(definition([stage("planning"), stage("planning")])),
    ).toThrow(/Duplicate stage id planning/);
    expect(() =>
      WorkflowDefinitionSchema.parse(definition([stage("planning", ["missing"])])),
    ).toThrow(/Unknown stage dependency missing/);
    expect(() =>
      WorkflowDefinitionSchema.parse(
        definition([stage("planning", ["review"]), stage("review", ["planning"])]),
      ),
    ).toThrow(/Cyclic stage dependency/);
  });
  it("validates typed artifact content", () => {
    expect(
      validateArtifactContent("test-report", { revision: "r", passed: true, tests: 2 }),
    ).toMatchObject({ passed: true });
    expect(() => validateArtifactContent("test-report", { passed: "yes" })).toThrow();
  });
  it("prevents definition path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-"));
    await writeFile(join(root, "agent.yaml"), "bad");
    await expect(safeResolve(root, "../secret.yaml")).rejects.toBeInstanceOf(UnsafePathError);
  });
  it("loads and validates YAML definitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-"));
    const value = agent("safe");
    await writeFile(join(root, "safe.yaml"), JSON.stringify(value));
    await expect(loadAgent(root, "safe.yaml")).resolves.toEqual(value);
  });
});

describe("harness boundary", () => {
  it("negotiates capabilities and returns typed incompatibility", async () => {
    const adapter = new ScriptedHarnessAdapter(
      {},
      {
        subagents: false,
        nestedSubagents: false,
        skills: true,
        mcp: false,
        structuredOutput: true,
        backgroundExecution: false,
        nativeWorktrees: false,
      },
    );
    await expect(assertHarnessCompatibility(adapter, ["mcp"])).rejects.toBeInstanceOf(
      HarnessCompatibilityError,
    );
    await expect(
      assertHarnessCompatibility(adapter, ["skills", "structuredOutput"]),
    ).resolves.toBeUndefined();
  });
  it("does not pretend scaffold invocation is implemented", async () => {
    const adapter = new CodexHarnessAdapter();
    const iterator = adapter.run({} as never);
    await expect(iterator.next()).rejects.toBeInstanceOf(UnsupportedHarnessOperationError);
  });
  it("normalizes scripted events through the neutral schema", async () => {
    const a = artifact("test-report", "test", "r", { revision: "r", passed: true, tests: 1 });
    const adapter = new ScriptedHarnessAdapter({ test: ({ runId }) => events(runId, a) });
    const received: AgentEvent[] = [];
    for await (const event of adapter.run({
      runId: "run-1",
      task: { stageId: "test" } as never,
      config: {} as never,
    }))
      received.push(AgentEventSchema.parse(event));
    expect(received.map((x) => x.type)).toEqual(["agent.started", "agent.completed"]);
  });
});

describe("artifacts", () => {
  it("invalidates source-bound evidence while documentation changes preserve it", () => {
    const report = artifact("test-report", "test", "r1", {
      revision: "r1",
      passed: true,
      tests: 1,
    });
    expect(invalidateArtifacts([report], "source", "r2")[0]?.validation.valid).toBe(false);
    expect(invalidateArtifacts([report], "documentation", "r1")[0]?.validation.valid).toBe(true);
  });
  it("invalidates plan and downstream evidence when criteria change", () => {
    const plan = artifact("implementation-plan", "planning", "r1", {
      summary: "x",
      steps: ["x"],
      acceptanceCriteria: ["x"],
    });
    expect(invalidateArtifacts([plan], "acceptance-criteria", "r2")[0]?.validation.valid).toBe(
      false,
    );
  });
});

const sqliteDescribe = Number(process.versions.node.split(".")[0]) >= 22 ? describe : describe.skip;
sqliteDescribe("SQLite repositories", () => {
  it("persists workflow state and ordered logs across process instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sqlite-"));
    const path = join(root, "factory.db");
    const first = new SqliteRepositories(path);
    const run = {
      id: "wf-persisted",
      workflowId: "slice",
      objective: "persist me",
      status: "waiting-approval" as const,
      revision: "initial",
      stageRuns: [],
      remediationAttempts: 0,
    };
    const started = AgentEventSchema.parse({
      type: "agent.started",
      runId: "stage-planning",
      agentId: "planner",
      timestamp: timestamp(),
    });
    const completed = AgentEventSchema.parse({
      type: "agent.message",
      runId: "stage-planning",
      content: "planned",
      timestamp: timestamp(),
    });
    await first.workflowRuns.save(run);
    await first.events.append(run.id, started);
    await first.events.append(run.id, completed);
    first.close();

    const second = new SqliteRepositories(path);
    await expect(second.workflowRuns.get(run.id)).resolves.toEqual(run);
    await expect(second.events.list(run.id)).resolves.toEqual([started, completed]);
    second.close();
  });

  it("replaces an artifact collection atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sqlite-"));
    const repositories = new SqliteRepositories(join(root, "factory.db"));
    const oldArtifact = artifact("test-report", "test", "r1", {
      revision: "r1",
      passed: true,
      tests: 1,
    });
    const newArtifact = artifact("test-report", "test", "r2", {
      revision: "r2",
      passed: true,
      tests: 2,
    });
    await repositories.artifacts.save("wf-replace", oldArtifact);
    await repositories.artifacts.replace("wf-replace", [newArtifact]);
    await expect(repositories.artifacts.list("wf-replace")).resolves.toEqual([newArtifact]);
    repositories.close();
  });
});

describe("workflow vertical slice", () => {
  it("prevents concurrent workspace writers", () => {
    const lease = new WorkspaceWriterLease();
    lease.acquire("construction-1");
    expect(() => lease.acquire("testing-1")).toThrow(ConcurrentWriterError);
    lease.release("construction-1");
    expect(() => lease.acquire("testing-1")).not.toThrow();
  });
  it("cancels durably and does not resume a terminal workflow", async () => {
    const repositories = new InMemoryRepositories();
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) =>
        events(
          runId,
          artifact("implementation-plan", "planning", "initial", {
            summary: "p",
            steps: ["x"],
            acceptanceCriteria: ["x"],
          }),
        ),
    });
    const planner = agent("planner");
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      WorkflowDefinitionSchema.parse({
        apiVersion: "agent-factory.dev/v1alpha1",
        kind: "Workflow",
        metadata: { id: "cancel", version: "1" },
        stages: [
          {
            id: "planning",
            kind: "agent",
            agentId: "planner",
            outputArtifact: "implementation-plan",
          },
          { id: "plan-approval", kind: "approval", dependsOn: ["planning"] },
        ],
      }),
      new Map([[planner.metadata.id, planner]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );
    const paused = await engine.submit("cancel me");

    const cancelled = await engine.cancel(paused.id, "operator cancelled");
    const resumed = await engine.resume(paused.id);

    expect(cancelled.status).toBe("cancelled");
    expect(resumed.status).toBe("cancelled");
  });
  it("restricts agent permissions to the stage permission boundary", async () => {
    const repositories = new InMemoryRepositories();
    let receivedPermissions: unknown;
    const adapter = new ScriptedHarnessAdapter({
      construction: ({ runId, task }) => {
        receivedPermissions = task.permissions;
        return events(
          runId,
          artifact("source-change", "construction", "r1", {
            revision: "r1",
            changedPaths: ["src/x.ts"],
            changeKind: "source",
          }),
        );
      },
    });
    const constructor = AgentDefinitionSchema.parse({
      ...agent("constructor", true),
      spec: {
        ...agent("constructor", true).spec,
        permissions: {
          filesystem: "workspace-write",
          network: "allow",
          commands: ["pnpm test", "pnpm build"],
        },
      },
    });
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      WorkflowDefinitionSchema.parse({
        apiVersion: "agent-factory.dev/v1alpha1",
        kind: "Workflow",
        metadata: { id: "least-privilege", version: "1" },
        stages: [
          {
            id: "construction",
            kind: "agent",
            agentId: "constructor",
            outputArtifact: "source-change",
            permissions: {
              filesystem: "read-only",
              network: "deny",
              commands: ["pnpm test"],
            },
          },
        ],
      }),
      new Map([[constructor.metadata.id, constructor]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );

    const run = await engine.submit("use the least privilege permissions");

    expect(run.status).toBe("completed");
    expect(receivedPermissions).toEqual({
      filesystem: "read-only",
      network: "deny",
      commands: ["pnpm test"],
    });
  });
  it("does not let a stage grant permissions absent from the agent definition", async () => {
    const repositories = new InMemoryRepositories();
    let receivedPermissions: unknown;
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId, task }) => {
        receivedPermissions = task.permissions;
        return events(
          runId,
          artifact("implementation-plan", "planning", "initial", {
            summary: "p",
            steps: ["x"],
            acceptanceCriteria: ["x"],
          }),
        );
      },
    });
    const planner = agent("planner");
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      WorkflowDefinitionSchema.parse({
        apiVersion: "agent-factory.dev/v1alpha1",
        kind: "Workflow",
        metadata: { id: "no-elevation", version: "1" },
        stages: [
          {
            id: "planning",
            kind: "agent",
            agentId: "planner",
            outputArtifact: "implementation-plan",
            permissions: {
              filesystem: "workspace-write",
              network: "allow",
              commands: ["rm -rf"],
            },
          },
        ],
      }),
      new Map([[planner.metadata.id, planner]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );

    await engine.submit("do not elevate permissions");

    expect(receivedPermissions).toEqual({
      filesystem: "read-only",
      network: "deny",
      commands: [],
    });
  });
  it("retries retryable harness failures within the stage limit", async () => {
    const repositories = new InMemoryRepositories();
    let attempts = 0;
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) => {
        attempts++;
        return attempts === 1
          ? [
              AgentEventSchema.parse({
                type: "agent.failed",
                runId,
                error: { code: "TEMPORARY", message: "retry", retryable: true },
                timestamp: timestamp(),
              }),
            ]
          : events(
              runId,
              artifact("implementation-plan", "planning", "initial", {
                summary: "p",
                steps: ["x"],
                acceptanceCriteria: ["x"],
              }),
            );
      },
    });
    const retryWorkflow = WorkflowDefinitionSchema.parse({
      apiVersion: "agent-factory.dev/v1alpha1",
      kind: "Workflow",
      metadata: { id: "retry", version: "1" },
      policy: { maximumAttemptsPerStage: 2, maximumTotalRemediationAttempts: 1 },
      stages: [
        {
          id: "planning",
          kind: "agent",
          agentId: "planner",
          outputArtifact: "implementation-plan",
        },
      ],
    });
    const planner = agent("planner");
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      retryWorkflow,
      new Map([[planner.metadata.id, planner]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );
    const run = await engine.submit("retry work");
    expect(run.status).toBe("completed");
    expect(run.stageRuns[0]?.attempts).toBe(2);
  });
  it("escalates when a harness returns a different artifact type", async () => {
    const repositories = new InMemoryRepositories();
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) =>
        events(
          runId,
          artifact("test-report", "planning", "initial", {
            revision: "initial",
            passed: true,
            tests: 1,
          }),
        ),
    });
    const planner = agent("planner");
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      WorkflowDefinitionSchema.parse({
        apiVersion: "agent-factory.dev/v1alpha1",
        kind: "Workflow",
        metadata: { id: "output-contract", version: "1" },
        stages: [
          {
            id: "planning",
            kind: "agent",
            agentId: "planner",
            outputArtifact: "implementation-plan",
          },
        ],
      }),
      new Map([[planner.metadata.id, planner]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );

    const run = await engine.submit("reject incorrect output");

    expect(run.status).toBe("escalated");
    expect(run.escalationReason).toContain("expected implementation-plan");
    expect(await repositories.artifacts.list(run.id)).toEqual([]);
  });
  it("records artifact provenance from the trusted task boundary", async () => {
    const repositories = new InMemoryRepositories();
    const returned = artifact("implementation-plan", "untrusted-stage", "untrusted-revision", {
      summary: "p",
      steps: ["x"],
      acceptanceCriteria: ["x"],
    });
    returned.producer = { kind: "human", id: "untrusted-producer" };
    returned.validation = { valid: false, errors: ["untrusted"] };
    returned.inputArtifactIds = ["untrusted-input"];
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) => events(runId, returned),
    });
    const planner = agent("planner");
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      WorkflowDefinitionSchema.parse({
        apiVersion: "agent-factory.dev/v1alpha1",
        kind: "Workflow",
        metadata: { id: "provenance", version: "1" },
        stages: [
          {
            id: "planning",
            kind: "agent",
            agentId: "planner",
            outputArtifact: "implementation-plan",
          },
        ],
      }),
      new Map([[planner.metadata.id, planner]]),
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );

    const run = await engine.submit("bind provenance");
    const [saved] = await repositories.artifacts.list(run.id);

    expect(run.status).toBe("completed");
    expect(saved).toMatchObject({
      producingStageId: "planning",
      producer: { kind: "agent", id: "planner" },
      inputArtifactIds: [],
      validation: { valid: true, errors: [] },
      sourceRevision: "initial",
    });
  });
  it("pauses, resumes, remediates a failed review, invalidates stale evidence, and completes", async () => {
    const repositories = new InMemoryRepositories();
    let construction = 0;
    let reviews = 0;
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) =>
        events(
          runId,
          artifact("implementation-plan", "planning", "initial", {
            summary: "plan",
            steps: ["implement"],
            acceptanceCriteria: ["passes"],
          }),
        ),
      construction: ({ runId }) => {
        construction++;
        return events(
          runId,
          artifact("source-change", "construction", `r${construction}`, {
            revision: `r${construction}`,
            changedPaths: ["src/x.ts"],
            changeKind: "source",
          }),
        );
      },
      test: ({ runId, task }) =>
        events(
          runId,
          artifact("test-report", "test", task.workspace.revision, {
            revision: task.workspace.revision,
            passed: true,
            tests: 1,
          }),
        ),
      "code-review": ({ runId, task }) => {
        reviews++;
        return events(
          runId,
          artifact("code-review", "code-review", task.workspace.revision, {
            revision: task.workspace.revision,
            approved: reviews === 2,
            findings: reviews === 1 ? [finding("bug-1", task.workspace.revision)] : [],
          }),
        );
      },
    });
    const agents = new Map(
      [agent("planner"), agent("constructor", true), agent("tester", true), agent("reviewer")].map(
        (x) => [x.metadata.id, x],
      ),
    );
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      workflow,
      agents,
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );
    const paused = await engine.submit("do work");
    expect(paused.status).toBe("waiting-approval");
    const approval = (await repositories.approvals.list(paused.id))[0]!;
    const completed = await engine.approve(approval.id, "human");
    expect(completed.status).toBe("completed");
    expect(completed.remediationAttempts).toBe(1);
    expect(construction).toBe(2);
    const artifacts = await repositories.artifacts.list(completed.id);
    expect(artifacts.some((x) => x.type === "remediation-request")).toBe(true);
    expect(artifacts.filter((x) => x.type === "test-report" && !x.validation.valid)).toHaveLength(
      1,
    );
    expect((await repositories.events.list(completed.id)).length).toBeGreaterThan(8);
  });
  it("escalates recurring findings instead of looping forever", async () => {
    const repositories = new InMemoryRepositories();
    let revision = 0;
    const adapter = new ScriptedHarnessAdapter({
      planning: ({ runId }) =>
        events(
          runId,
          artifact("implementation-plan", "planning", "initial", {
            summary: "p",
            steps: ["x"],
            acceptanceCriteria: ["x"],
          }),
        ),
      construction: ({ runId }) => {
        revision++;
        return events(
          runId,
          artifact("source-change", "construction", `r${revision}`, {
            revision: `r${revision}`,
            changedPaths: ["x"],
            changeKind: "source",
          }),
        );
      },
      test: ({ runId, task }) =>
        events(
          runId,
          artifact("test-report", "test", task.workspace.revision, {
            revision: task.workspace.revision,
            passed: true,
            tests: 1,
          }),
        ),
      "code-review": ({ runId, task }) =>
        events(
          runId,
          artifact("code-review", "code-review", task.workspace.revision, {
            revision: task.workspace.revision,
            approved: false,
            findings: [finding("same", task.workspace.revision)],
          }),
        ),
    });
    const agents = new Map(
      [agent("planner"), agent("constructor", true), agent("tester", true), agent("reviewer")].map(
        (x) => [x.metadata.id, x],
      ),
    );
    const engine = new WorkflowEngine(
      repositories,
      adapter,
      workflow,
      agents,
      new Map([[skill.name, skill]]),
      new Map([[profile.id, profile]]),
    );
    const paused = await engine.submit("x");
    const approval = (await repositories.approvals.list(paused.id))[0]!;
    const result = await engine.approve(approval.id, "human");
    expect(result.status).toBe("escalated");
    expect(result.escalationReason).toContain("same finding");
  });
});
