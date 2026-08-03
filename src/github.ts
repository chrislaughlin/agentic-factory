import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { invalidateArtifacts, validateArtifactContent } from "./artifacts.js";
import {
  isTerminalWorkflowStatus,
  type ArtifactInstance,
  type Finding,
  type WorkflowRun,
} from "./domain.js";
import type { FactoryRepositories } from "./repositories.js";

const execute = promisify(execFile);

export interface RepositoryIdentity {
  repository: string;
  defaultBranch: string;
  remote: string;
}

export interface GitRepositoryGateway {
  detect(root: string): Promise<RepositoryIdentity>;
  pushSafely(input: {
    root: string;
    remote: string;
    branch: string;
    baseRevision: string;
    headRevision: string;
  }): Promise<void>;
}

export interface PullRequestSnapshot {
  number: number;
  url: string;
  branch: string;
  baseBranch: string;
  baseRevision: string;
  headRevision: string;
  state: "open" | "closed" | "merged";
}

export const PullRequestSnapshotSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url(),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  baseRevision: z.string().min(1),
  headRevision: z.string().min(1),
  state: z.enum(["open", "closed", "merged"]),
});

export interface CheckJobEvidence {
  name: string;
  conclusion: string;
  failedSteps: string[];
  log: string;
}

export type GitHubEvent =
  | {
      key: string;
      kind: "check";
      revision: string;
      name: string;
      conclusion: string;
      url: string;
      jobs: CheckJobEvidence[];
    }
  | {
      key: string;
      kind: "review";
      revision: string;
      reviewKind: "comment" | "approval" | "changes-requested" | "inline-thread";
      body: string;
      author: string;
      threadId?: string | undefined;
      resolved: boolean;
    }
  | { key: string; kind: "head-changed"; previousRevision: string; revision: string };

const CheckJobEvidenceSchema = z.object({
  name: z.string(),
  conclusion: z.string(),
  failedSteps: z.array(z.string()),
  log: z.string(),
});
export const GitHubEventSchema = z.discriminatedUnion("kind", [
  z.object({
    key: z.string(),
    kind: z.literal("check"),
    revision: z.string(),
    name: z.string(),
    conclusion: z.string(),
    url: z.string().url(),
    jobs: z.array(CheckJobEvidenceSchema),
  }),
  z.object({
    key: z.string(),
    kind: z.literal("review"),
    revision: z.string(),
    reviewKind: z.enum(["comment", "approval", "changes-requested", "inline-thread"]),
    body: z.string(),
    author: z.string(),
    threadId: z.string().optional(),
    resolved: z.boolean(),
  }),
  z.object({
    key: z.string(),
    kind: z.literal("head-changed"),
    previousRevision: z.string(),
    revision: z.string(),
  }),
]);
const GitHubPollResultSchema = z.object({
  cursor: z.string(),
  events: z.array(GitHubEventSchema),
});
export const MergeResultSchema = z.object({
  mergeRevision: z.string().min(1),
  actor: z.string().min(1),
  mergedAt: z.string().datetime(),
  method: z.enum(["merge", "squash", "rebase"]),
});

export interface EnsurePullRequestInput {
  repository: string;
  branch: string;
  baseBranch: string;
  baseRevision: string;
  headRevision: string;
  title: string;
  body: string;
  existingPullRequestNumber?: number;
}

export interface GitHubProvider {
  ensurePullRequest(input: EnsurePullRequestInput): Promise<PullRequestSnapshot>;
  pollPullRequest(
    repository: string,
    number: number,
    cursor?: string,
  ): Promise<{ cursor: string; events: GitHubEvent[] }>;
  mergePullRequest(input: {
    repository: string;
    number: number;
    expectedHeadRevision: string;
    method: "merge" | "squash" | "rebase";
  }): Promise<z.infer<typeof MergeResultSchema>>;
}

export type FeedbackClassification =
  | "actionable"
  | "flaky"
  | "infrastructure"
  | "duplicate"
  | "non-actionable"
  | "reasoning-required"
  | "stale";

export type FeedbackTriage = (event: GitHubEvent) => Promise<FeedbackClassification>;

/** Resolves otherwise ambiguous PR comments conservatively without leaving a run deadlocked. */
export const conservativeFeedbackTriage: FeedbackTriage = async (event) => {
  if (event.kind !== "review") return "non-actionable";
  const body = event.body.trim();
  if (/\b(flaky|intermittent|rerun)\b/iu.test(body)) return "flaky";
  if (/\b(infrastructure|runner|service unavailable|network timeout)\b/iu.test(body))
    return "infrastructure";
  if (/\b(duplicate|already addressed|superseded)\b/iu.test(body)) return "duplicate";
  if (!body || /^(lgtm|approved|thanks|thank you|looks good)[.!\s]*$/iu.test(body))
    return "non-actionable";
  return "actionable";
};

export class GitHubLifecycle {
  constructor(
    private readonly repositories: FactoryRepositories,
    private readonly provider: GitHubProvider,
    private readonly git: GitRepositoryGateway,
    private readonly triage: FeedbackTriage = conservativeFeedbackTriage,
    private readonly maximumExternalRemediationAttempts = 8,
  ) {}

  async publish(
    workflowRunId: string,
    input: { title: string; body: string },
  ): Promise<PullRequestSnapshot> {
    const run = await this.requireRun(workflowRunId);
    if (!run.workspace) throw new Error(`Workflow ${run.id} has no isolated workspace`);
    if (!new Set(["locally-verified", "waiting-ci", "waiting-review"]).has(run.status))
      throw new Error(`Workflow ${run.id} is not locally verified`);
    const identity = await this.git.detect(run.workspace.root);
    await this.git.pushSafely({
      root: run.workspace.root,
      remote: identity.remote,
      branch: run.workspace.branch,
      baseRevision: run.workspace.baseRevision,
      headRevision: run.revision,
    });
    const existing = (await this.repositories.artifacts.list(run.id))
      .filter((artifact) => artifact.type === "pull-request" && artifact.validation.valid)
      .at(-1);
    const existingNumber = (existing?.content as { number?: number } | undefined)?.number;
    const pullRequest = PullRequestSnapshotSchema.parse(
      await this.provider.ensurePullRequest({
        repository: identity.repository,
        branch: run.workspace.branch,
        baseBranch: identity.defaultBranch,
        baseRevision: run.workspace.baseRevision,
        headRevision: run.revision,
        title: input.title,
        body: input.body,
        ...(existingNumber ? { existingPullRequestNumber: existingNumber } : {}),
      }),
    );
    await this.repositories.artifacts.save(
      run.id,
      artifact(`github-pr-${pullRequest.number}`, "pull-request", "github-publish", run.revision, {
        repository: identity.repository,
        ...pullRequest,
      }),
    );
    run.status = "waiting-ci";
    await this.repositories.workflowRuns.save(run);
    return pullRequest;
  }

  async poll(workflowRunId: string): Promise<{
    processed: number;
    duplicates: number;
    remediationRequired: boolean;
    readyForFinalApproval: boolean;
  }> {
    const run = await this.requireRun(workflowRunId);
    if (isTerminalWorkflowStatus(run.status))
      return {
        processed: 0,
        duplicates: 0,
        remediationRequired: false,
        readyForFinalApproval: false,
      };
    const pullArtifact = (await this.repositories.artifacts.list(run.id))
      .filter((candidate) => candidate.type === "pull-request" && candidate.validation.valid)
      .at(-1);
    if (!pullArtifact) throw new Error(`Workflow ${run.id} has no pull request artifact`);
    const pullRequest = pullArtifact.content as { repository: string; number: number };
    const scope = `github:${pullRequest.repository}#${pullRequest.number}`;
    const savedCursor = await this.repositories.integrationCursors.get(scope);
    const polled = GitHubPollResultSchema.parse(
      await this.provider.pollPullRequest(
        pullRequest.repository,
        pullRequest.number,
        savedCursor?.cursor,
      ),
    );
    let processed = 0;
    let duplicates = 0;
    let headChanged = false;
    const batchKeys = new Set<string>();
    const pendingEventRecords: Array<{
      key: string;
      workflowRunId: string;
      kind: string;
      receivedAt: string;
      payload: GitHubEvent;
    }> = [];
    const actionable: Array<{
      event: Exclude<GitHubEvent, { kind: "head-changed" }>;
      classification: FeedbackClassification;
    }> = [];
    for (const event of polled.events) {
      if (batchKeys.has(event.key) || (await this.repositories.externalEvents.has(event.key))) {
        duplicates++;
        continue;
      }
      batchKeys.add(event.key);
      pendingEventRecords.push({
        key: event.key,
        workflowRunId: run.id,
        kind: event.kind,
        receivedAt: new Date().toISOString(),
        payload: event,
      });
      processed++;
      if (event.kind === "head-changed") {
        if (event.revision !== run.revision) {
          const all = await this.repositories.artifacts.list(run.id);
          await this.repositories.artifacts.replace(
            run.id,
            invalidateArtifacts(all, "source", event.revision),
          );
          run.revision = event.revision;
          resetLocalVerificationStages(run);
          run.status = "running";
          headChanged = true;
        }
        continue;
      }
      let classification = classifyFeedback(event, run.revision);
      if (classification === "reasoning-required") classification = await this.triage(event);
      await this.persistFeedback(run, event, classification);
      if (classification === "actionable") actionable.push({ event, classification });
    }
    const currentArtifacts = await this.repositories.artifacts.list(run.id);
    const currentCi = currentArtifacts.filter(
      (artifact) =>
        artifact.type === "ci-result" &&
        artifact.validation.valid &&
        artifact.sourceRevision === run.revision,
    );
    const currentReviews = currentArtifacts.filter(
      (artifact) =>
        artifact.type === "review-feedback" &&
        artifact.validation.valid &&
        artifact.sourceRevision === run.revision,
    );
    const hasApproval = currentReviews.some(
      (artifact) => (artifact.content as { reviewKind?: string }).reviewKind === "approval",
    );
    const hasUnresolvedRequest = currentReviews.some((artifact) => {
      const content = artifact.content as { reviewKind?: string; resolved?: boolean };
      return (
        !content.resolved &&
        (content.reviewKind === "changes-requested" || content.reviewKind === "inline-thread")
      );
    });
    const hasPendingTriage = currentReviews.some(
      (artifact) =>
        (artifact.content as { classification?: string }).classification === "reasoning-required",
    );
    const readyForFinalApproval =
      !actionable.length &&
      currentCi.length > 0 &&
      currentCi.every((artifact) => (artifact.content as { passed?: boolean }).passed) &&
      hasApproval &&
      !hasUnresolvedRequest &&
      !hasPendingTriage;
    if (actionable.length) {
      const existingRemediationIds = new Set(
        currentArtifacts
          .filter((candidate) => candidate.type === "remediation-request")
          .map((candidate) => candidate.id),
      );
      for (const { event } of actionable) {
        const remediationId = `github-remediation-${safeId(event.key)}`;
        if (!existingRemediationIds.has(remediationId)) {
          const finding = feedbackFinding(event);
          await this.repositories.artifacts.save(
            run.id,
            artifact(remediationId, "remediation-request", "github-monitor", run.revision, {
              revision: run.revision,
              findings: [finding],
              findingFingerprints: [finding.fingerprint],
              guidance:
                "Address actionable GitHub CI and review feedback, then publish a new revision",
            }),
          );
          existingRemediationIds.add(remediationId);
        }
      }
      const durableRemediationCount = (await this.repositories.artifacts.list(run.id)).filter(
        (candidate) => candidate.type === "remediation-request",
      ).length;
      run.remediationAttempts = Math.max(run.remediationAttempts, durableRemediationCount);
      if (run.remediationAttempts > this.maximumExternalRemediationAttempts) {
        run.status = "escalated";
        run.escalationReason = "External remediation budget exceeded";
      } else {
        resetLocalVerificationStages(run);
        run.status = "running";
      }
    } else if (!headChanged && (processed || readyForFinalApproval)) {
      run.status = "waiting-review";
    }
    await this.repositories.workflowRuns.save(run);
    for (const record of pendingEventRecords) await this.repositories.externalEvents.append(record);
    await this.repositories.integrationCursors.save({
      scope,
      cursor: polled.cursor,
      updatedAt: new Date().toISOString(),
    });
    return {
      processed,
      duplicates,
      remediationRequired: actionable.length > 0,
      readyForFinalApproval,
    };
  }

  private async persistFeedback(
    run: WorkflowRun,
    event: Exclude<GitHubEvent, { kind: "head-changed" }>,
    classification: FeedbackClassification,
  ): Promise<void> {
    if (event.kind === "check") {
      await this.supersedeFeedback(
        run.id,
        (artifact) =>
          artifact.type === "ci-result" &&
          artifact.sourceRevision === event.revision &&
          (artifact.content as { name?: string }).name === event.name,
        event.key,
      );
      await this.repositories.artifacts.save(
        run.id,
        artifact(`github-${safeId(event.key)}`, "ci-result", "github-monitor", event.revision, {
          eventKey: event.key,
          revision: event.revision,
          name: event.name,
          passed: event.conclusion === "success",
          conclusion: event.conclusion,
          url: event.url,
          jobs: event.jobs,
          classification,
        }),
      );
    } else {
      await this.supersedeFeedback(
        run.id,
        (artifact) => {
          if (artifact.type !== "review-feedback" || artifact.sourceRevision !== event.revision)
            return false;
          const content = artifact.content as {
            author?: string;
            reviewKind?: string;
            threadId?: string;
          };
          if (event.threadId) return content.threadId === event.threadId;
          return (
            event.reviewKind === "approval" &&
            content.author === event.author &&
            content.reviewKind === "changes-requested"
          );
        },
        event.key,
      );
      await this.repositories.artifacts.save(
        run.id,
        artifact(
          `github-${safeId(event.key)}`,
          "review-feedback",
          "github-monitor",
          event.revision,
          {
            eventKey: event.key,
            revision: event.revision,
            reviewKind: event.reviewKind,
            body: event.body,
            author: event.author,
            ...(event.threadId ? { threadId: event.threadId } : {}),
            resolved: event.resolved,
            classification,
          },
        ),
      );
    }
  }

  private async supersedeFeedback(
    workflowRunId: string,
    matches: (artifact: ArtifactInstance) => boolean,
    eventKey: string,
  ): Promise<void> {
    const artifacts = await this.repositories.artifacts.list(workflowRunId);
    if (!artifacts.some((artifact) => artifact.validation.valid && matches(artifact))) return;
    await this.repositories.artifacts.replace(
      workflowRunId,
      artifacts.map((artifact) =>
        artifact.validation.valid && matches(artifact)
          ? {
              ...artifact,
              validation: {
                valid: false,
                errors: [`superseded by GitHub event ${eventKey}`],
              },
              invalidatedAt: new Date().toISOString(),
              invalidationReason: "superseded GitHub event",
            }
          : artifact,
      ),
    );
  }

  private async requireRun(id: string): Promise<WorkflowRun> {
    const run = await this.repositories.workflowRuns.get(id);
    if (!run) throw new Error(`Workflow not found: ${id}`);
    return run;
  }
}

export function classifyFeedback(
  event: GitHubEvent,
  currentRevision: string,
): FeedbackClassification {
  if (event.kind === "head-changed") return "non-actionable";
  if (event.revision !== currentRevision) return "stale";
  if (event.kind === "review") {
    if (event.reviewKind === "approval" || event.resolved) return "non-actionable";
    if (event.reviewKind === "changes-requested" || event.reviewKind === "inline-thread")
      return "actionable";
    return "reasoning-required";
  }
  if (
    event.conclusion === "success" ||
    event.conclusion === "neutral" ||
    event.conclusion === "skipped"
  )
    return "non-actionable";
  if (
    event.conclusion === "pending" ||
    event.conclusion === "queued" ||
    event.conclusion === "in_progress"
  )
    return "non-actionable";
  const evidence = event.jobs.map((job) => `${job.name} ${job.log}`).join(" ");
  if (/flaky|intermittent/iu.test(evidence)) return "flaky";
  if (/runner|service unavailable|network timeout|infrastructure/iu.test(evidence))
    return "infrastructure";
  return "actionable";
}

function feedbackFinding(event: Exclude<GitHubEvent, { kind: "head-changed" }>): Finding {
  const isCheck = event.kind === "check";
  return {
    id: `finding-${safeId(event.key)}`,
    severity: isCheck ? "high" : "medium",
    title: isCheck ? `CI check failed: ${event.name}` : "GitHub review requests changes",
    description: isCheck
      ? event.jobs.map((job) => job.failedSteps.join(", ")).join("; ")
      : event.body,
    evidence: isCheck ? event.jobs.map((job) => job.log).join("\n") : event.body,
    sourceLocation: { path: isCheck ? "github:checks" : "github:review" },
    revision: event.revision,
    fingerprint: `github-${event.key}`,
    resolved: false,
  };
}

function artifact(
  id: string,
  type: string,
  producerId: string,
  revision: string,
  content: unknown,
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

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function resetLocalVerificationStages(run: WorkflowRun): void {
  const constructionIndex = run.stageRuns.findIndex((stage) => stage.stageId === "construction");
  if (constructionIndex < 0) return;
  for (const stage of run.stageRuns.slice(constructionIndex)) {
    if (stage.status !== "waiting-approval") stage.status = "pending";
  }
}

export class LocalGitRepositoryGateway implements GitRepositoryGateway {
  async detect(root: string): Promise<RepositoryIdentity> {
    const { stdout: remoteUrl } = await execute("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
    });
    const repository = parseGitHubRepository(remoteUrl.trim());
    let defaultBranch = "main";
    try {
      const { stdout } = await execute(
        "git",
        ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        {
          cwd: root,
        },
      );
      defaultBranch = stdout.trim().replace(/^origin\//u, "");
    } catch {
      // Repositories without a local origin/HEAD use the conventional default until the provider responds.
    }
    return { repository, defaultBranch, remote: "origin" };
  }

  async pushSafely(input: {
    root: string;
    remote: string;
    branch: string;
    baseRevision: string;
    headRevision: string;
  }): Promise<void> {
    const { stdout } = await execute("git", ["rev-parse", input.branch], { cwd: input.root });
    if (stdout.trim() !== input.headRevision)
      throw new Error(
        `Branch ${input.branch} no longer points to expected head ${input.headRevision}`,
      );
    await execute("git", ["merge-base", "--is-ancestor", input.baseRevision, input.headRevision], {
      cwd: input.root,
    });
    await execute("git", ["push", "--set-upstream", input.remote, input.branch], {
      cwd: input.root,
    });
  }
}

export function parseGitHubRepository(remoteUrl: string): string {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(remoteUrl);
  if (!match) throw new Error(`Origin is not a GitHub repository: ${remoteUrl}`);
  return `${match[1]}/${match[2]}`;
}

/** Production provider backed by the authenticated GitHub CLI. Polling is one-shot and caller scheduled. */
export class GhCliGitHubProvider implements GitHubProvider {
  async ensurePullRequest(input: EnsurePullRequestInput): Promise<PullRequestSnapshot> {
    let number = input.existingPullRequestNumber;
    if (number) {
      await execute("gh", [
        "pr",
        "edit",
        String(number),
        "--repo",
        input.repository,
        "--title",
        input.title,
        "--body",
        input.body,
        "--base",
        input.baseBranch,
      ]);
    } else {
      const { stdout } = await execute("gh", [
        "pr",
        "create",
        "--repo",
        input.repository,
        "--head",
        input.branch,
        "--base",
        input.baseBranch,
        "--title",
        input.title,
        "--body",
        input.body,
      ]);
      number = Number(stdout.trim().split("/").at(-1));
    }
    const { stdout } = await execute("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      input.repository,
      "--json",
      "number,url,headRefName,baseRefName,headRefOid,state",
    ]);
    const value = JSON.parse(stdout) as {
      number: number;
      url: string;
      headRefName: string;
      baseRefName: string;
      headRefOid: string;
      state: string;
    };
    return {
      number: value.number,
      url: value.url,
      branch: value.headRefName,
      baseBranch: value.baseRefName,
      baseRevision: input.baseRevision,
      headRevision: value.headRefOid,
      state: value.state.toLowerCase() as PullRequestSnapshot["state"],
    };
  }

  async pollPullRequest(
    repository: string,
    number: number,
    cursor?: string,
  ): Promise<{ cursor: string; events: GitHubEvent[] }> {
    void cursor;
    const [{ stdout }, { stdout: reviewsJson }] = await Promise.all([
      execute("gh", [
        "pr",
        "view",
        String(number),
        "--repo",
        repository,
        "--json",
        "headRefOid,comments,statusCheckRollup",
      ]),
      execute("gh", ["api", `repos/${repository}/pulls/${number}/reviews`]),
    ]);
    const value = z
      .object({
        headRefOid: z.string(),
        comments: z.array(
          z.object({ id: z.string(), body: z.string(), author: z.object({ login: z.string() }) }),
        ),
        statusCheckRollup: z.array(
          z.object({
            __typename: z.string(),
            name: z.string().optional(),
            conclusion: z.string().optional(),
            detailsUrl: z.string().optional(),
          }),
        ),
      })
      .parse(JSON.parse(stdout));
    const reviews = z
      .array(
        z.object({
          id: z.union([z.string(), z.number()]).transform(String),
          state: z.string(),
          body: z
            .string()
            .nullable()
            .transform((body) => body ?? ""),
          commit_id: z.string(),
          user: z.object({ login: z.string() }),
        }),
      )
      .parse(JSON.parse(reviewsJson));
    const events: GitHubEvent[] = [
      {
        key: `head-${value.headRefOid}`,
        kind: "head-changed",
        previousRevision: "unknown",
        revision: value.headRefOid,
      },
    ];
    for (const check of value.statusCheckRollup) {
      const name = check.name ?? check.__typename;
      const conclusion = (check.conclusion ?? "pending").toLowerCase();
      const jobs = await this.fetchFailedJobEvidence(
        repository,
        name,
        conclusion,
        check.detailsUrl,
      );
      events.push({
        key: `check-${value.headRefOid}-${safeId(name)}-${conclusion}`,
        kind: "check",
        revision: value.headRefOid,
        name,
        conclusion,
        url: check.detailsUrl ?? `https://github.com/${repository}/pull/${number}/checks`,
        jobs,
      });
    }
    for (const review of reviews) {
      events.push({
        key: `review-${review.id}`,
        kind: "review",
        revision: review.commit_id,
        reviewKind:
          review.state === "CHANGES_REQUESTED"
            ? "changes-requested"
            : review.state === "APPROVED"
              ? "approval"
              : "comment",
        body: review.body,
        author: review.user.login,
        resolved: false,
      });
    }
    for (const comment of value.comments) {
      events.push({
        key: `comment-${comment.id}`,
        kind: "review",
        revision: value.headRefOid,
        reviewKind: "comment",
        body: comment.body,
        author: comment.author.login,
        resolved: false,
      });
    }
    events.push(...(await this.fetchReviewThreads(repository, number, value.headRefOid)));
    return { cursor: new Date().toISOString(), events };
  }

  private async fetchReviewThreads(
    repository: string,
    number: number,
    revision: string,
  ): Promise<GitHubEvent[]> {
    const [owner, name] = repository.split("/");
    if (!owner || !name) return [];
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,comments(first:1){nodes{body author{login} path line commit{oid}}}}}}}}`;
    let stdout: string;
    try {
      ({ stdout } = await execute("gh", [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${number}`,
      ]));
    } catch (error) {
      throw new Error(
        `Failed to retrieve review threads: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const nodes = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              reviewThreads: z.object({
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    isResolved: z.boolean(),
                    comments: z.object({
                      nodes: z.array(
                        z.object({
                          body: z.string(),
                          author: z.object({ login: z.string() }).nullable(),
                          commit: z.object({ oid: z.string() }).nullable().optional(),
                        }),
                      ),
                    }),
                  }),
                ),
              }),
            }),
          }),
        }),
      })
      .parse(JSON.parse(stdout)).data.repository.pullRequest.reviewThreads.nodes;
    return nodes.map((thread) => {
      const comment = thread.comments.nodes[0];
      return {
        key: `thread-${thread.id}-${thread.isResolved ? "resolved" : "open"}`,
        kind: "review" as const,
        revision: comment?.commit?.oid ?? revision,
        reviewKind: "inline-thread" as const,
        body: comment?.body ?? "Inline review thread",
        author: comment?.author?.login ?? "unknown",
        threadId: thread.id,
        resolved: thread.isResolved,
      };
    });
  }

  private async fetchFailedJobEvidence(
    repository: string,
    checkName: string,
    conclusion: string,
    detailsUrl?: string,
  ): Promise<CheckJobEvidence[]> {
    const runId = /\/actions\/runs\/(\d+)/u.exec(detailsUrl ?? "")?.[1];
    if (!runId || conclusion !== "failure")
      return [
        {
          name: checkName,
          conclusion,
          failedSteps: conclusion === "failure" ? [checkName] : [],
          log: detailsUrl ?? "No log URL was supplied by GitHub",
        },
      ];
    try {
      const [{ stdout: jobsJson }, { stdout: failedLog }] = await Promise.all([
        execute("gh", ["run", "view", runId, "--repo", repository, "--json", "jobs"]),
        execute("gh", ["run", "view", runId, "--repo", repository, "--log-failed"]),
      ]);
      const jobs = (
        JSON.parse(jobsJson) as {
          jobs: Array<{
            name: string;
            conclusion: string;
            steps: Array<{ name: string; conclusion: string }>;
          }>;
        }
      ).jobs;
      return jobs
        .filter((job) => job.conclusion.toLowerCase() === "failure")
        .map((job) => ({
          name: job.name,
          conclusion: job.conclusion.toLowerCase(),
          failedSteps: job.steps
            .filter((step) => step.conclusion.toLowerCase() === "failure")
            .map((step) => step.name),
          log: failedLog,
        }));
    } catch (error) {
      return [
        {
          name: checkName,
          conclusion,
          failedSteps: [checkName],
          log: `Failed to retrieve structured Actions logs: ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  }

  async mergePullRequest(input: {
    repository: string;
    number: number;
    expectedHeadRevision: string;
    method: "merge" | "squash" | "rebase";
  }): Promise<z.infer<typeof MergeResultSchema>> {
    const { stdout: before } = await execute("gh", [
      "pr",
      "view",
      String(input.number),
      "--repo",
      input.repository,
      "--json",
      "headRefOid",
    ]);
    const head = (JSON.parse(before) as { headRefOid: string }).headRefOid;
    if (head !== input.expectedHeadRevision)
      throw new Error(`Pull request head changed from ${input.expectedHeadRevision} to ${head}`);
    await execute("gh", [
      "pr",
      "merge",
      String(input.number),
      "--repo",
      input.repository,
      `--${input.method}`,
      "--match-head-commit",
      input.expectedHeadRevision,
    ]);
    const { stdout: after } = await execute("gh", [
      "pr",
      "view",
      String(input.number),
      "--repo",
      input.repository,
      "--json",
      "mergeCommit,mergedAt,mergedBy",
    ]);
    const merged = JSON.parse(after) as {
      mergeCommit: { oid: string };
      mergedAt: string;
      mergedBy: { login: string };
    };
    return {
      mergeRevision: merged.mergeCommit.oid,
      actor: merged.mergedBy.login,
      mergedAt: merged.mergedAt,
      method: input.method,
    };
  }
}
