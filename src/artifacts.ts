import { z } from "zod";
import { FindingSchema, type ArtifactInstance } from "./domain.js";

const CommandEvidenceSchema = z.object({
  id: z.string(),
  commandId: z.string(),
  executable: z.string(),
  arguments: z.array(z.string()),
  cwd: z.string(),
  revision: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  passed: z.boolean(),
  timedOut: z.boolean(),
});

const schemas: Record<string, z.ZodType> = {
  "work-request": z.object({ objective: z.string().min(1) }),
  "clarification-request": z.object({
    requestId: z.string(),
    question: z.string().min(1),
    status: z.literal("pending"),
  }),
  "clarification-answer": z.object({ requestId: z.string(), value: z.string().min(1) }),
  "implementation-plan": z.object({
    summary: z.string(),
    steps: z.array(z.string()).min(1),
    acceptanceCriteria: z.array(z.string()).min(1),
    risks: z.array(z.string()).default([]),
    verificationStrategy: z.array(z.string()).default([]),
  }),
  "source-change": z.object({
    revision: z.string(),
    changedPaths: z.array(z.string()),
    changeKind: z.enum(["source", "test", "documentation"]),
  }),
  "test-report": z.object({
    revision: z.string(),
    passed: z.boolean(),
    tests: z.number().int().nonnegative(),
  }),
  "code-review": z.object({
    revision: z.string(),
    approved: z.boolean(),
    findings: z.array(FindingSchema),
  }),
  "security-review": z.object({
    revision: z.string(),
    approved: z.boolean(),
    findings: z.array(FindingSchema),
  }),
  "qa-report": z.object({
    revision: z.string(),
    passed: z.boolean(),
    findings: z.array(FindingSchema),
  }),
  "command-report": z.object({
    revision: z.string(),
    passed: z.boolean(),
    commands: z.array(CommandEvidenceSchema).min(1),
  }),
  "quality-gate": z.object({
    revision: z.string(),
    passed: z.boolean(),
    missingArtifactTypes: z.array(z.string()),
    invalidArtifactTypes: z.array(z.string()),
    blockingFingerprints: z.array(z.string()),
  }),
  "remediation-request": z.object({
    revision: z.string().optional(),
    findings: z.array(FindingSchema).default([]),
    findingFingerprints: z.array(z.string()).min(1),
    guidance: z.string(),
  }),
  approval: z.object({ approved: z.boolean(), approver: z.string() }),
  "pull-request": z.object({
    number: z.number().int().positive(),
    url: z.string().url(),
    repository: z.string(),
    branch: z.string(),
    baseBranch: z.string(),
    baseRevision: z.string(),
    headRevision: z.string(),
    state: z.enum(["open", "closed", "merged"]),
  }),
  "ci-result": z.object({
    eventKey: z.string(),
    revision: z.string(),
    name: z.string(),
    passed: z.boolean(),
    conclusion: z.string(),
    url: z.string().url(),
    jobs: z.array(
      z.object({
        name: z.string(),
        conclusion: z.string(),
        failedSteps: z.array(z.string()),
        log: z.string(),
      }),
    ),
    classification: z.string(),
  }),
  "review-feedback": z.object({
    eventKey: z.string(),
    revision: z.string(),
    reviewKind: z.enum(["comment", "approval", "changes-requested", "inline-thread"]),
    body: z.string(),
    author: z.string(),
    threadId: z.string().optional(),
    resolved: z.boolean(),
    classification: z.string(),
  }),
  "merge-result": z.object({
    repository: z.string(),
    pullRequestNumber: z.number().int().positive(),
    headRevision: z.string(),
    mergeRevision: z.string(),
    method: z.enum(["merge", "squash", "rebase"]),
    actor: z.string(),
    mergedAt: z.string().datetime(),
  }),
  "deployment-result": z.object({
    id: z.string(),
    revision: z.string(),
    environment: z.string(),
    state: z.enum(["pending", "running", "succeeded", "failed", "rolled-back"]),
    logs: z.array(z.string()),
    smokeCommandIds: z.array(z.string()),
  }),
  "post-deployment-verification": z.object({
    deploymentId: z.string(),
    revision: z.string(),
    passed: z.boolean(),
    commands: z.array(CommandEvidenceSchema),
  }),
  "rollback-result": z.object({
    deploymentId: z.string(),
    revision: z.string(),
    successful: z.boolean(),
    logs: z.array(z.string()),
  }),
  "final-report": z.object({
    branch: z.string(),
    worktree: z.string(),
    revision: z.string(),
    artifactIds: z.array(z.string()),
    findings: z.array(FindingSchema),
    commands: z.array(CommandEvidenceSchema),
    retries: z.object({ remediation: z.number().int().nonnegative() }),
    outcome: z.enum(["locally-verified", "completed", "rolled-back", "failed", "escalated"]),
  }),
};

export class ArtifactValidationError extends Error {
  constructor(
    public readonly artifactType: string,
    public readonly issues: string[],
  ) {
    super(`Invalid ${artifactType} artifact: ${issues.join(", ")}`);
  }
}

export function validateArtifactContent(type: string, content: unknown): unknown {
  const schema = schemas[type];
  if (!schema) throw new ArtifactValidationError(type, ["unknown artifact type"]);
  const result = schema.safeParse(content);
  if (!result.success)
    throw new ArtifactValidationError(
      type,
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}

export type ChangeKind = "source" | "test" | "documentation" | "acceptance-criteria";
const invalidationTypes: Record<ChangeKind, ReadonlySet<string>> = {
  source: new Set([
    "test-report",
    "command-report",
    "security-review",
    "qa-report",
    "code-review",
    "quality-gate",
    "final-report",
    "ci-result",
    "review-feedback",
  ]),
  test: new Set([
    "test-report",
    "command-report",
    "qa-report",
    "code-review",
    "quality-gate",
    "final-report",
    "ci-result",
    "review-feedback",
  ]),
  documentation: new Set(),
  "acceptance-criteria": new Set([
    "implementation-plan",
    "source-change",
    "test-report",
    "command-report",
    "security-review",
    "qa-report",
    "code-review",
    "ci-result",
    "review-feedback",
    "quality-gate",
    "final-report",
  ]),
};

export function invalidateArtifacts(
  artifacts: ArtifactInstance[],
  kind: ChangeKind,
  revision: string,
  now = new Date().toISOString(),
): ArtifactInstance[] {
  const types = invalidationTypes[kind];
  return artifacts.map((artifact) =>
    artifact.validation.valid &&
    (types.has(artifact.type) ||
      (artifact.sourceRevision !== revision && isRevisionBound(artifact.type)))
      ? {
          ...artifact,
          validation: { valid: false, errors: [`invalidated by ${kind} change at ${revision}`] },
          invalidatedAt: now,
          invalidationReason: `${kind} change`,
        }
      : artifact,
  );
}

function isRevisionBound(type: string): boolean {
  return new Set([
    "test-report",
    "command-report",
    "security-review",
    "qa-report",
    "code-review",
    "quality-gate",
    "final-report",
    "ci-result",
    "review-feedback",
  ]).has(type);
}
