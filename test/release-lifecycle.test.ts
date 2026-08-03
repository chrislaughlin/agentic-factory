import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactInstance, WorkflowRun } from "../src/domain.js";
import type { GitHubProvider } from "../src/github.js";
import { DeterministicCommandRunner } from "../src/infrastructure.js";
import {
  CommandDeploymentProvider,
  ReleaseLifecycle,
  StaleApprovalError,
  type DeploymentProvider,
  type DeploymentSnapshot,
} from "../src/release.js";
import { SqliteRepositories } from "../src/repositories.js";

class MergeProvider implements GitHubProvider {
  mergeInputs: Array<{ expectedHeadRevision: string }> = [];
  mergeError: Error | undefined;

  async ensurePullRequest(): Promise<never> {
    throw new Error("not used");
  }
  async pollPullRequest(): Promise<never> {
    throw new Error("not used");
  }
  async mergePullRequest(input: { expectedHeadRevision: string }) {
    this.mergeInputs.push(input);
    if (this.mergeError) throw this.mergeError;
    return {
      mergeRevision: "merge-1",
      actor: "operator",
      mergedAt: new Date().toISOString(),
      method: "squash" as const,
    };
  }
}

class FakeDeploymentProvider implements DeploymentProvider {
  snapshot: DeploymentSnapshot = {
    id: "deployment-1",
    environment: "production",
    revision: "merge-1",
    state: "running",
    logs: ["deploying"],
  };
  starts = 0;
  rollbacks = 0;

  async start() {
    this.starts++;
    return this.snapshot;
  }
  async observe() {
    return { cursor: `cursor-${this.snapshot.state}`, deployment: this.snapshot };
  }
  async rollback() {
    this.rollbacks++;
    return { ...this.snapshot, state: "rolled-back" as const, logs: ["rolled back"] };
  }
}

const workflowRun = (): WorkflowRun => ({
  id: "workflow-release",
  workflowId: "complete-sdlc",
  objective: "release safely",
  status: "waiting-review",
  revision: "head-1",
  workspace: { root: "/tmp/release", branch: "agent-factory/release", baseRevision: "base-1" },
  stageRuns: [],
  remediationAttempts: 0,
});

async function seedFinalGateEvidence(
  repositories: SqliteRepositories,
  run: WorkflowRun,
): Promise<string[]> {
  const values: ArtifactInstance[] = [
    testArtifact("pull-request", "pr", run.revision, {
      number: 42,
      url: "https://github.com/example/project/pull/42",
      repository: "example/project",
      branch: run.workspace!.branch,
      baseBranch: "main",
      baseRevision: run.workspace!.baseRevision,
      headRevision: run.revision,
      state: "open",
    }),
    testArtifact("ci-result", "ci", run.revision, {
      eventKey: "check-1",
      revision: run.revision,
      name: "validate",
      passed: true,
      conclusion: "success",
      url: "https://github.com/example/project/actions/runs/1",
      jobs: [],
      classification: "non-actionable",
    }),
    testArtifact("review-feedback", "review", run.revision, {
      eventKey: "review-1",
      revision: run.revision,
      reviewKind: "approval",
      body: "Approved",
      author: "reviewer",
      resolved: true,
      classification: "non-actionable",
    }),
  ];
  for (const value of values) await repositories.artifacts.save(run.id, value);
  return values.map((value) => value.id);
}

function testArtifact(
  type: string,
  id: string,
  revision: string,
  content: unknown,
): ArtifactInstance {
  return {
    id,
    type,
    version: "v1",
    producingStageId: "test",
    producer: { kind: "tool", id: "test" },
    createdAt: new Date().toISOString(),
    inputArtifactIds: [],
    validation: { valid: true, errors: [] },
    content,
    sourceRevision: revision,
  };
}

describe("release lifecycle", () => {
  it("requires command deployments to attest their deployed revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-command-deploy-"));
    const commands = new DeterministicCommandRunner({
      commands: [
        {
          id: "deploy",
          executable: process.execPath,
          arguments: [
            "-e",
            "console.log(JSON.stringify({revision:process.env.AGENT_FACTORY_REVISION,deploymentId:'production-1'}))",
          ],
        },
      ],
    });
    const provider = new CommandDeploymentProvider(commands, {
      workspaceRoot: directory,
      stateRoot: join(directory, "deployments"),
      deployCommandId: "deploy",
    });

    const started = await provider.start({
      workflowRunId: "workflow-release",
      revision: "merge-exact",
      environment: "production",
    });
    expect(started).toMatchObject({
      id: "production-1",
      revision: "merge-exact",
      environment: "production",
      state: "succeeded",
    });
    await expect(provider.observe(started.id)).resolves.toMatchObject({
      deployment: { id: "production-1", revision: "merge-exact" },
    });

    const unattested = new CommandDeploymentProvider(
      new DeterministicCommandRunner({
        commands: [
          { id: "deploy", executable: process.execPath, arguments: ["-e", "process.exit(0)"] },
        ],
      }),
      {
        workspaceRoot: directory,
        stateRoot: join(directory, "unattested"),
        deployCommandId: "deploy",
      },
    );
    await expect(
      unattested.start({
        workflowRunId: "workflow-release",
        revision: "merge-exact",
        environment: "production",
      }),
    ).rejects.toThrow("did not attest the deployed revision");
  });

  it("rejects stale approval, merges the expected head, and resumes deployment verification", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-release-"));
    const database = join(directory, "factory.db");
    const github = new MergeProvider();
    const deployment = new FakeDeploymentProvider();
    const commands = new DeterministicCommandRunner({
      commands: [
        { id: "smoke", executable: process.execPath, arguments: ["-e", "process.exit(0)"] },
      ],
    });
    const firstRepositories = new SqliteRepositories(database);
    const run = workflowRun();
    run.workspace!.root = directory;
    await firstRepositories.workflowRuns.save(run);
    const lifecycle = new ReleaseLifecycle(firstRepositories, github, deployment, commands);
    const evidence = await seedFinalGateEvidence(firstRepositories, run);
    const approval = await lifecycle.requestFinalApproval(run.id, evidence);

    run.revision = "head-2";
    await firstRepositories.workflowRuns.save(run);
    await expect(
      lifecycle.approveAndDeploy(approval.id, "operator", {
        repository: "example/project",
        pullRequestNumber: 42,
        mergeMethod: "squash",
        environment: "production",
        smokeCommandIds: ["smoke"],
      }),
    ).rejects.toBeInstanceOf(StaleApprovalError);
    expect(github.mergeInputs).toHaveLength(0);

    run.revision = "head-1";
    await firstRepositories.workflowRuns.save(run);
    await lifecycle.approveAndDeploy(approval.id, "operator", {
      repository: "example/project",
      pullRequestNumber: 42,
      mergeMethod: "squash",
      environment: "production",
      smokeCommandIds: ["smoke"],
    });
    firstRepositories.close();

    deployment.snapshot = { ...deployment.snapshot, state: "succeeded", logs: ["deployed"] };
    const secondRepositories = new SqliteRepositories(database);
    const restarted = new ReleaseLifecycle(secondRepositories, github, deployment, commands);
    const completed = await restarted.observe(run.id);

    expect(github.mergeInputs).toEqual([
      expect.objectContaining({ expectedHeadRevision: "head-1" }),
    ]);
    expect(completed.status).toBe("completed");
    expect((await secondRepositories.artifacts.list(run.id)).map((value) => value.type)).toEqual(
      expect.arrayContaining(["merge-result", "deployment-result", "post-deployment-verification"]),
    );
    secondRepositories.close();
  });

  it("rolls back a failed deployment when the provider supports rollback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-rollback-"));
    const repositories = new SqliteRepositories(join(directory, "factory.db"));
    const github = new MergeProvider();
    const deployment = new FakeDeploymentProvider();
    deployment.snapshot = { ...deployment.snapshot, state: "failed", logs: ["deployment failed"] };
    const commands = new DeterministicCommandRunner({ commands: [] });
    const run = workflowRun();
    run.workspace!.root = directory;
    await repositories.workflowRuns.save(run);
    const lifecycle = new ReleaseLifecycle(repositories, github, deployment, commands);
    const approval = await lifecycle.requestFinalApproval(
      run.id,
      await seedFinalGateEvidence(repositories, run),
    );
    await lifecycle.approveAndDeploy(approval.id, "operator", {
      repository: "example/project",
      pullRequestNumber: 42,
      mergeMethod: "squash",
      environment: "production",
      smokeCommandIds: [],
    });

    const result = await lifecycle.observe(run.id);

    expect(result.status).toBe("rolled-back");
    expect(deployment.rollbacks).toBe(1);
    repositories.close();
  });

  it("rolls back when post-deployment smoke verification fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-smoke-"));
    const repositories = new SqliteRepositories(join(directory, "factory.db"));
    const github = new MergeProvider();
    const deployment = new FakeDeploymentProvider();
    deployment.snapshot = { ...deployment.snapshot, state: "succeeded", logs: ["deployed"] };
    const commands = new DeterministicCommandRunner({
      commands: [
        { id: "smoke", executable: process.execPath, arguments: ["-e", "process.exit(1)"] },
      ],
    });
    const run = workflowRun();
    run.workspace!.root = directory;
    await repositories.workflowRuns.save(run);
    const lifecycle = new ReleaseLifecycle(repositories, github, deployment, commands);
    const approval = await lifecycle.requestFinalApproval(
      run.id,
      await seedFinalGateEvidence(repositories, run),
    );
    await lifecycle.approveAndDeploy(approval.id, "operator", {
      repository: "example/project",
      pullRequestNumber: 42,
      mergeMethod: "squash",
      environment: "production",
      smokeCommandIds: ["smoke"],
    });

    const result = await lifecycle.observe(run.id);

    expect(result.status).toBe("rolled-back");
    expect(deployment.rollbacks).toBe(1);
    expect(
      (await repositories.artifacts.list(run.id)).find(
        (artifact) => artifact.type === "post-deployment-verification",
      )?.content,
    ).toMatchObject({ passed: false });
    repositories.close();
  });

  it("fails safely when the provider detects a merge race", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-merge-race-"));
    const repositories = new SqliteRepositories(join(directory, "factory.db"));
    const github = new MergeProvider();
    github.mergeError = new Error("head changed during merge");
    const deployment = new FakeDeploymentProvider();
    const run = workflowRun();
    run.workspace!.root = directory;
    await repositories.workflowRuns.save(run);
    const lifecycle = new ReleaseLifecycle(
      repositories,
      github,
      deployment,
      new DeterministicCommandRunner({ commands: [] }),
    );
    const approval = await lifecycle.requestFinalApproval(
      run.id,
      await seedFinalGateEvidence(repositories, run),
    );

    await expect(
      lifecycle.approveAndDeploy(approval.id, "operator", {
        repository: "example/project",
        pullRequestNumber: 42,
        mergeMethod: "squash",
        environment: "production",
        smokeCommandIds: [],
      }),
    ).rejects.toThrow("head changed during merge");

    expect(await repositories.workflowRuns.get(run.id)).toMatchObject({
      status: "escalated",
      escalationReason: expect.stringContaining("Merge failed safely"),
    });
    expect(deployment.starts).toBe(0);
    repositories.close();
  });

  it("refuses final approval without current PR, CI, and review evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-final-gate-"));
    const repositories = new SqliteRepositories(join(directory, "factory.db"));
    const run = workflowRun();
    await repositories.workflowRuns.save(run);
    const lifecycle = new ReleaseLifecycle(
      repositories,
      new MergeProvider(),
      new FakeDeploymentProvider(),
      new DeterministicCommandRunner({ commands: [] }),
    );

    await expect(lifecycle.requestFinalApproval(run.id, [])).rejects.toThrow(
      "has not passed local, CI, and review gates",
    );

    run.status = "locally-verified";
    await repositories.workflowRuns.save(run);
    await expect(
      lifecycle.requestFinalApproval(run.id, await seedFinalGateEvidence(repositories, run)),
    ).rejects.toThrow("has not passed local, CI, and review gates");
    repositories.close();
  });
});
