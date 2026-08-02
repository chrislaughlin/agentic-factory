import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelProfileSchema } from "../src/domain.js";
import { GitHubLifecycle, type GitHubProvider, type GitRepositoryGateway } from "../src/github.js";
import {
  ClaudeCodeHarnessAdapter,
  CodexHarnessAdapter,
  OpenCodeHarnessAdapter,
  ProcessHarnessAdapter,
  UnsupportedHarnessOperationError,
} from "../src/harness.js";
import { DeterministicCommandRunner } from "../src/infrastructure.js";
import { loadAgent, loadSkills, loadWorkflow } from "../src/loader.js";
import { StructuredObservability } from "../src/observability.js";
import { ReleaseLifecycle, type DeploymentProvider } from "../src/release.js";
import { InMemoryRepositories } from "../src/repositories.js";
import { WorkflowEngine } from "../src/workflow.js";

describe("release hardening", () => {
  it("emits correlated structured logs and metrics without secrets", () => {
    const lines: string[] = [];
    const observability = new StructuredObservability({
      sink: (line) => lines.push(line),
      secrets: ["literal-secret"],
    });
    const scope = observability.scope({ workflowRunId: "workflow-1", stageId: "security" });

    scope.info("stage.completed", {
      apiToken: "token-value",
      message: "removed literal-secret from output",
      nested: { password: "password-value" },
    });
    scope.increment("agent_factory_stage_completed", 1, { outcome: "success" });

    const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(logged).toMatchObject({
      event: "stage.completed",
      workflowRunId: "workflow-1",
      stageId: "security",
      data: {
        apiToken: "[REDACTED]",
        message: "removed [REDACTED] from output",
        nested: { password: "[REDACTED]" },
      },
    });
    expect(observability.metrics()).toEqual([
      {
        name: "agent_factory_stage_completed",
        value: 1,
        labels: { outcome: "success", workflowRunId: "workflow-1", stageId: "security" },
      },
    ]);
  });

  it("terminates timed-out deterministic commands with typed evidence", async () => {
    const runner = new DeterministicCommandRunner({
      commands: [
        {
          id: "timeout",
          executable: process.execPath,
          arguments: ["-e", "setTimeout(() => {}, 10000)"],
          timeoutMilliseconds: 20,
        },
      ],
    });

    const result = await runner.run("timeout", { cwd: ".", revision: "revision-1" });

    expect(result).toMatchObject({ passed: false, timedOut: true });
  });

  it("validates truthful adapter contracts for Codex, Claude Code, and OpenCode", async () => {
    for (const adapter of [
      new CodexHarnessAdapter(),
      new ClaudeCodeHarnessAdapter(),
      new OpenCodeHarnessAdapter(),
    ]) {
      const capabilities = await adapter.inspectCapabilities();
      expect(capabilities.skills).toBe(true);
      await expect(adapter.run({} as never).next()).rejects.toBeInstanceOf(
        UnsupportedHarnessOperationError,
      );
    }
  });

  it("completes the full release lifecycle through a real process harness", async () => {
    const root = resolve(".");
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
    const harnessScript = `
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => body += chunk);
      process.stdin.on("end", () => {
        const input = JSON.parse(body);
        const task = input.task;
        const stage = task.stageId;
        const timestamp = new Date().toISOString();
        const remediating = task.inputs.some(value => value.type === "remediation-request");
        const revision = stage === "construction" ? (remediating ? "revision-2" : "revision-1") : task.workspace.revision;
        const type = stage === "planning" ? "implementation-plan"
          : stage === "construction" ? "source-change"
          : stage === "test" ? "test-report"
          : stage === "security" ? "security-review"
          : stage === "qa" ? "qa-report" : "code-review";
        const finding = {
          id: "finding-process-edge", severity: "high", title: "Boundary condition",
          description: "The first revision needs remediation", evidence: "revision-1 is intentional",
          sourceLocation: { path: "src/example.ts", line: 1 }, revision,
          fingerprint: "process-edge", resolved: false
        };
        const content = stage === "planning"
          ? { summary: "Release a verified change", steps: ["implement", "verify", "release"],
              acceptanceCriteria: ["production smoke check passes"], risks: ["stale evidence"],
              verificationStrategy: ["deterministic checks and independent review"] }
          : stage === "construction"
            ? { revision, changedPaths: ["src/example.ts"], changeKind: "source" }
            : stage === "test"
              ? { revision, passed: true, tests: 5 }
              : stage === "security"
                ? { revision, approved: true, findings: [] }
                : stage === "qa"
                  ? { revision, passed: true, findings: [] }
                  : { revision, approved: revision === "revision-2", findings: revision === "revision-2" ? [] : [finding] };
        const artifact = {
          id: "artifact-" + stage + "-" + revision, type, version: "v1", producingStageId: stage,
          producer: { kind: "agent", id: task.agentId }, createdAt: timestamp, inputArtifactIds: [],
          validation: { valid: true, errors: [] }, content, sourceRevision: revision
        };
        console.log(JSON.stringify({ type: "agent.started", runId: input.runId, agentId: task.agentId, timestamp }));
        console.log(JSON.stringify({ type: "agent.completed", runId: input.runId,
          result: { status: "succeeded", summary: stage + " complete", artifact }, timestamp }));
      });
    `;
    const harness = new ProcessHarnessAdapter({
      executable: process.execPath,
      arguments: ["-e", harnessScript],
      timeoutMilliseconds: 5_000,
    });
    const profile = ModelProfileSchema.parse({
      id: "balanced",
      providers: { process: { model: "local-process" } },
    });
    const commands = new DeterministicCommandRunner({
      commands: ["test", "typecheck", "lint", "build", "security", "smoke"].map((id) => ({
        id,
        executable: process.execPath,
        arguments: ["-e", "process.exit(0)"],
      })),
    });
    const repositories = new InMemoryRepositories();
    const engine = new WorkflowEngine(
      repositories,
      harness,
      workflow,
      new Map(agents.map((value) => [value.metadata.id, value])),
      new Map(skills.map((value) => [value.name, value])),
      new Map([[profile.id, profile]]),
      commands,
    );
    const workspace = await mkdtemp(join(tmpdir(), "factory-e2e-"));
    const paused = await engine.submit("Complete a production release", "base-1", {
      root: workspace,
      branch: "agent-factory/e2e",
      baseRevision: "base-1",
    });
    const planApproval = (await repositories.approvals.list(paused.id))[0]!;
    const verified = await engine.approve(planApproval.id, "planning-operator");
    expect(verified).toMatchObject({ status: "locally-verified", remediationAttempts: 1 });

    const git: GitRepositoryGateway = {
      detect: async () => ({
        repository: "example/project",
        defaultBranch: "main",
        remote: "origin",
      }),
      pushSafely: async () => {},
    };
    const github: GitHubProvider = {
      ensurePullRequest: async () => ({
        number: 42,
        url: "https://github.com/example/project/pull/42",
        branch: "agent-factory/e2e",
        baseBranch: "main",
        baseRevision: "base-1",
        headRevision: "revision-2",
        state: "open",
      }),
      pollPullRequest: async () => ({
        cursor: "complete",
        events: [
          {
            key: "e2e-check",
            kind: "check",
            revision: "revision-2",
            name: "validate",
            conclusion: "success",
            url: "https://github.com/example/project/actions/runs/1",
            jobs: [{ name: "validate", conclusion: "success", failedSteps: [], log: "passed" }],
          },
          {
            key: "e2e-review",
            kind: "review",
            revision: "revision-2",
            reviewKind: "approval",
            body: "Approved",
            author: "reviewer",
            resolved: true,
          },
        ],
      }),
      mergePullRequest: async ({ expectedHeadRevision, method }) => ({
        mergeRevision: `merge-${expectedHeadRevision}`,
        actor: "release-operator",
        mergedAt: new Date().toISOString(),
        method,
      }),
    };
    const githubLifecycle = new GitHubLifecycle(repositories, github, git);
    await githubLifecycle.publish(verified.id, { title: "Release", body: "Locally verified" });
    await githubLifecycle.poll(verified.id);

    const deployment: DeploymentProvider = {
      start: async ({ revision, environment }) => ({
        id: "deployment-e2e",
        environment,
        revision,
        state: "running",
        logs: ["started"],
      }),
      observe: async () => ({
        cursor: "deployed",
        deployment: {
          id: "deployment-e2e",
          environment: "production",
          revision: "merge-revision-2",
          state: "succeeded",
          logs: ["healthy"],
        },
      }),
    };
    const release = new ReleaseLifecycle(repositories, github, deployment, commands);
    const evidence = (await repositories.artifacts.list(verified.id)).map((value) => value.id);
    const finalApproval = await release.requestFinalApproval(verified.id, evidence);
    await release.approveAndDeploy(finalApproval.id, "release-operator", {
      repository: "example/project",
      pullRequestNumber: 42,
      mergeMethod: "squash",
      environment: "production",
      smokeCommandIds: ["smoke"],
    });
    const completed = await release.observe(verified.id);

    expect(completed.status).toBe("completed");
    expect((await repositories.approvals.list(verified.id)).map((value) => value.kind)).toEqual([
      "plan",
      "final",
    ]);
    expect((await repositories.artifacts.list(verified.id)).map((value) => value.type)).toEqual(
      expect.arrayContaining([
        "remediation-request",
        "pull-request",
        "ci-result",
        "review-feedback",
        "merge-result",
        "deployment-result",
        "post-deployment-verification",
      ]),
    );
  });
});
