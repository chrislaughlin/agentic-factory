import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../src/domain.js";
import type { GitHubProvider } from "../src/github.js";
import { DeterministicCommandRunner } from "../src/infrastructure.js";
import {
  ReleaseLifecycle,
  StaleApprovalError,
  type DeploymentProvider,
  type DeploymentSnapshot,
} from "../src/release.js";
import { SqliteRepositories } from "../src/repositories.js";

class MergeProvider implements GitHubProvider {
  mergeInputs: Array<{ expectedHeadRevision: string }> = [];

  async ensurePullRequest(): Promise<never> {
    throw new Error("not used");
  }
  async pollPullRequest(): Promise<never> {
    throw new Error("not used");
  }
  async mergePullRequest(input: { expectedHeadRevision: string }) {
    this.mergeInputs.push(input);
    return {
      mergeRevision: "merge-1",
      actor: "operator",
      mergedAt: new Date().toISOString(),
      method: "squash",
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

describe("release lifecycle", () => {
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
    const approval = await lifecycle.requestFinalApproval(run.id, ["evidence-1"]);

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
    const approval = await lifecycle.requestFinalApproval(run.id, []);
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
});
