import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GitHubLifecycle,
  type GitHubEvent,
  type GitHubProvider,
  type GitRepositoryGateway,
} from "../src/github.js";
import { SqliteRepositories } from "../src/repositories.js";
import type { WorkflowRun } from "../src/domain.js";

class FakeGitHubProvider implements GitHubProvider {
  ensureInputs: Array<{ existingPullRequestNumber?: number }> = [];
  pollInputs: Array<string | undefined> = [];
  events: GitHubEvent[] = [];

  async ensurePullRequest(input: { existingPullRequestNumber?: number }) {
    this.ensureInputs.push(input);
    return {
      number: 42,
      url: "https://github.com/example/project/pull/42",
      branch: "agent-factory/run-1",
      baseBranch: "main",
      baseRevision: "base-1",
      headRevision: "revision-1",
      state: "open" as const,
    };
  }

  async pollPullRequest(_repository: string, _number: number, cursor?: string) {
    this.pollInputs.push(cursor);
    return { cursor: "cursor-1", events: this.events };
  }

  async mergePullRequest(): Promise<never> {
    throw new Error("not used");
  }
}

class FakeGitRepository implements GitRepositoryGateway {
  pushes: string[] = [];

  async detect() {
    return { repository: "example/project", defaultBranch: "main", remote: "origin" };
  }

  async pushSafely(input: { branch: string }) {
    this.pushes.push(input.branch);
  }
}

const run: WorkflowRun = {
  id: "workflow-github",
  workflowId: "complete-local-sdlc",
  objective: "publish the verified change",
  status: "locally-verified",
  revision: "revision-1",
  workspace: {
    root: "/tmp/workflow-github",
    branch: "agent-factory/run-1",
    baseRevision: "base-1",
  },
  stageRuns: [],
  remediationAttempts: 0,
};

describe("GitHub lifecycle", () => {
  it("updates one PR and processes CI/review events exactly once across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-github-"));
    const database = join(directory, "factory.db");
    const provider = new FakeGitHubProvider();
    const git = new FakeGitRepository();
    const firstRepositories = new SqliteRepositories(database);
    await firstRepositories.workflowRuns.save(run);
    const first = new GitHubLifecycle(firstRepositories, provider, git);

    const published = await first.publish(run.id, {
      title: "Complete the workflow",
      body: "Verified locally",
    });
    await first.publish(run.id, { title: "Complete the workflow", body: "Updated evidence" });

    expect(published).toMatchObject({ number: 42, headRevision: "revision-1" });
    expect(git.pushes).toEqual(["agent-factory/run-1", "agent-factory/run-1"]);
    expect(provider.ensureInputs[1]).toMatchObject({ existingPullRequestNumber: 42 });
    expect(
      (await firstRepositories.artifacts.list(run.id)).filter(
        (value) => value.type === "pull-request",
      ),
    ).toHaveLength(1);

    provider.events = [
      {
        key: "check-100",
        kind: "check",
        revision: "revision-1",
        name: "test",
        conclusion: "failure",
        url: "https://github.com/example/project/actions/runs/100",
        jobs: [
          { name: "test", conclusion: "failure", failedSteps: ["unit tests"], log: "1 failed" },
        ],
      },
      {
        key: "review-200",
        kind: "review",
        revision: "revision-1",
        reviewKind: "changes-requested",
        body: "Handle the failing edge case",
        author: "reviewer",
        threadId: "thread-1",
        resolved: false,
      },
    ];
    const firstPoll = await first.poll(run.id);
    firstRepositories.close();

    const secondRepositories = new SqliteRepositories(database);
    const restarted = new GitHubLifecycle(secondRepositories, provider, git);
    const secondPoll = await restarted.poll(run.id);

    expect(firstPoll).toMatchObject({ processed: 2, duplicates: 0, remediationRequired: true });
    expect(secondPoll).toMatchObject({ processed: 0, duplicates: 2 });
    expect(provider.pollInputs).toEqual([undefined, "cursor-1"]);
    expect(await secondRepositories.externalEvents.list(run.id)).toHaveLength(2);
    expect(
      (await secondRepositories.artifacts.list(run.id)).some(
        (value) => value.type === "remediation-request",
      ),
    ).toBe(true);
    secondRepositories.close();
  });
});
