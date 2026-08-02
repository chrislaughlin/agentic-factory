import { z } from "zod";
import type { ArtifactInstance } from "./domain.js";

const schemas: Record<string, z.ZodType> = {
  "work-request": z.object({ objective: z.string().min(1) }),
  "implementation-plan": z.object({
    summary: z.string(),
    steps: z.array(z.string()).min(1),
    acceptanceCriteria: z.array(z.string()).min(1),
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
    findings: z.array(z.unknown()),
  }),
  "security-review": z.object({
    revision: z.string(),
    approved: z.boolean(),
    findings: z.array(z.unknown()),
  }),
  "qa-report": z.object({
    revision: z.string(),
    passed: z.boolean(),
    findings: z.array(z.unknown()),
  }),
  "remediation-request": z.object({
    findingFingerprints: z.array(z.string()).min(1),
    guidance: z.string(),
  }),
  approval: z.object({ approved: z.boolean(), approver: z.string() }),
  "pull-request": z.object({ url: z.string().url(), revision: z.string() }),
  "ci-result": z.object({ revision: z.string(), passed: z.boolean() }),
  "deployment-result": z.object({
    revision: z.string(),
    environment: z.string(),
    successful: z.boolean(),
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
  source: new Set(["test-report", "security-review", "qa-report", "code-review", "ci-result"]),
  test: new Set(["test-report", "qa-report", "code-review", "ci-result"]),
  documentation: new Set(),
  "acceptance-criteria": new Set([
    "implementation-plan",
    "source-change",
    "test-report",
    "security-review",
    "qa-report",
    "code-review",
    "ci-result",
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
  return new Set(["test-report", "security-review", "qa-report", "code-review", "ci-result"]).has(
    type,
  );
}
