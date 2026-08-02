import { z } from "zod";

export const API_VERSION = "agent-factory.dev/v1alpha1" as const;
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Timestamp = z.string().datetime();

export const PermissionSetSchema = z.object({
  filesystem: z.enum(["deny", "read-only", "workspace-write"]).default("deny"),
  network: z.enum(["deny", "allow"]).default("deny"),
  commands: z.array(z.string()).default([]),
});
export type PermissionSet = z.infer<typeof PermissionSetSchema>;

export const AgentDefinitionSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("Agent"),
  metadata: z.object({ id: Id, displayName: z.string().min(1), version: z.string().min(1) }),
  spec: z.object({
    description: z.string().min(1),
    instructions: z.object({ file: z.string().min(1) }),
    capabilities: z.object({ skills: z.array(Id), tools: z.array(Id) }),
    permissions: PermissionSetSchema,
    model: z.object({ profile: Id }),
    execution: z.object({
      maxTurns: z.number().int().positive(),
      timeoutSeconds: z.number().int().positive(),
    }),
    output: z.object({ schema: z.string().min(1) }),
  }),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const SkillDefinitionSchema = z.object({
  name: Id,
  version: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(z.string()).min(1),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()).min(1),
  instructions: z.string().min(1),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export const ToolDefinitionSchema = z.object({
  id: Id,
  description: z.string(),
  deterministic: z.boolean(),
  permission: z.string(),
  command: z.object({ executable: z.string(), allowedArguments: z.array(z.string()) }).optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ModelProfileSchema = z.object({
  id: Id,
  providers: z.record(z.object({ model: z.string(), settings: z.record(z.unknown()).default({}) })),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const PolicyDefinitionSchema = z.object({
  maximumAttemptsPerStage: z.number().int().positive().default(3),
  maximumTotalRemediationAttempts: z.number().int().positive().default(8),
});
export type PolicyDefinition = z.infer<typeof PolicyDefinitionSchema>;

export const StageDefinitionSchema = z.object({
  id: Id,
  agentId: Id.optional(),
  kind: z.enum(["agent", "approval", "quality-gate", "tool"]),
  dependsOn: z.array(Id).default([]),
  inputArtifacts: z.array(z.string()).default([]),
  outputArtifact: z.string().optional(),
  requiredHarnessCapabilities: z.array(z.string()).default([]),
  commandIds: z.array(Id).default([]),
  permissions: PermissionSetSchema.optional(),
});
export type StageDefinition = z.infer<typeof StageDefinitionSchema>;

export const WorkflowDefinitionSchema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal("Workflow"),
    metadata: z.object({ id: Id, version: z.string() }),
    completionStatus: z.enum(["completed", "locally-verified"]).default("completed"),
    policy: PolicyDefinitionSchema.default({}),
    stages: z.array(StageDefinitionSchema).min(1),
  })
  .superRefine((workflow, context) => {
    const stageIndexes = new Map<string, number>();
    for (const [index, stage] of workflow.stages.entries()) {
      const existingIndex = stageIndexes.get(stage.id);
      if (existingIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate stage id ${stage.id} (first declared at stages.${existingIndex})`,
          path: ["stages", index, "id"],
        });
      } else {
        stageIndexes.set(stage.id, index);
      }
    }

    for (const [index, stage] of workflow.stages.entries()) {
      for (const [dependencyIndex, dependency] of stage.dependsOn.entries()) {
        if (!stageIndexes.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown stage dependency ${dependency}`,
            path: ["stages", index, "dependsOn", dependencyIndex],
          });
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (stageId: string, path: string[]): void => {
      if (visiting.has(stageId)) {
        const cycleStart = path.indexOf(stageId);
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cyclic stage dependency: ${[...path.slice(cycleStart), stageId].join(" -> ")}`,
          path: ["stages", stageIndexes.get(stageId) ?? 0, "dependsOn"],
        });
        return;
      }
      if (visited.has(stageId)) return;
      visiting.add(stageId);
      const stage = workflow.stages[stageIndexes.get(stageId)!];
      for (const dependency of stage?.dependsOn ?? []) {
        if (stageIndexes.has(dependency)) visit(dependency, [...path, stageId]);
      }
      visiting.delete(stageId);
      visited.add(stageId);
    };
    for (const stageId of stageIndexes.keys()) visit(stageId, []);
  });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const ArtifactDefinitionSchema = z.object({
  type: Id,
  version: z.literal("v1"),
  schema: z.string(),
});
export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;
export const ArtifactReferenceSchema = z.object({ artifactId: Id, type: Id, version: z.string() });

export const TaskEnvelopeSchema = z.object({
  taskId: Id,
  workflowRunId: Id,
  stageId: Id,
  agentId: Id,
  objective: z.string().min(1),
  requiredSkills: z.array(Id),
  optionalSkills: z.array(Id),
  workspace: z.object({ root: z.string(), branch: z.string().optional(), revision: z.string() }),
  inputs: z.array(ArtifactReferenceSchema),
  expectedOutput: z.object({ type: Id, version: z.string() }),
  permissions: PermissionSetSchema,
  metadata: z.record(z.unknown()),
});
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;

export const FindingSchema = z.object({
  id: Id,
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
  sourceLocation: z.object({ path: z.string(), line: z.number().int().positive().optional() }),
  revision: z.string(),
  fingerprint: z.string(),
  resolved: z.boolean().default(false),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ArtifactInstanceSchema = z.object({
  id: Id,
  type: Id,
  version: z.literal("v1"),
  producingStageId: Id,
  producer: z.object({ kind: z.enum(["agent", "tool", "human"]), id: Id }),
  createdAt: Timestamp,
  inputArtifactIds: z.array(Id),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()) }),
  content: z.unknown(),
  sourceRevision: z.string(),
  invalidatedAt: Timestamp.optional(),
  invalidationReason: z.string().optional(),
});
export type ArtifactInstance = z.infer<typeof ArtifactInstanceSchema>;

export const AgentResultSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  artifact: ArtifactInstanceSchema.optional(),
  summary: z.string(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
export const AgentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

const EventBase = z.object({ runId: Id, timestamp: Timestamp });
export const AgentEventSchema = z.discriminatedUnion("type", [
  EventBase.extend({ type: z.literal("agent.started"), agentId: Id }),
  EventBase.extend({ type: z.literal("agent.message"), content: z.string() }),
  EventBase.extend({ type: z.literal("tool.requested"), tool: z.string(), input: z.unknown() }),
  EventBase.extend({ type: z.literal("tool.completed"), tool: z.string(), output: z.unknown() }),
  EventBase.extend({ type: z.literal("artifact.created"), artifactId: Id }),
  EventBase.extend({ type: z.literal("approval.requested"), approvalId: Id }),
  EventBase.extend({ type: z.literal("agent.delegated"), childRunId: Id }),
  EventBase.extend({ type: z.literal("agent.completed"), result: AgentResultSchema }),
  EventBase.extend({ type: z.literal("agent.failed"), error: AgentErrorSchema }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const HarnessCapabilitiesSchema = z.object({
  subagents: z.boolean(),
  nestedSubagents: z.boolean(),
  skills: z.boolean(),
  mcp: z.boolean(),
  structuredOutput: z.boolean(),
  backgroundExecution: z.boolean(),
  nativeWorktrees: z.boolean(),
});
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

export type StageStatus =
  "pending" | "running" | "waiting-approval" | "completed" | "failed" | "invalidated";
export interface StageRun {
  id: string;
  stageId: string;
  status: StageStatus;
  attempts: number;
  artifactIds: string[];
}
export interface WorkflowRun {
  id: string;
  workflowId: string;
  objective: string;
  status:
    | "running"
    | "waiting-approval"
    | "locally-verified"
    | "waiting-ci"
    | "waiting-review"
    | "waiting-final-approval"
    | "merging"
    | "deploying"
    | "verifying"
    | "completed"
    | "rolled-back"
    | "failed"
    | "escalated"
    | "cancelled";
  revision: string;
  workspace?: { root: string; branch: string; baseRevision: string };
  configuration?: {
    harness: string;
    workflow: string;
    repository?: string;
    baseBranch?: string;
    modelProfile?: string;
    policy?: string;
  };
  stageRuns: StageRun[];
  remediationAttempts: number;
  escalationReason?: string;
}
export interface ApprovalRequest {
  id: string;
  workflowRunId: string;
  stageId: string;
  status: "pending" | "approved" | "rejected";
  kind?: "plan" | "final";
  revision?: string;
  evidenceArtifactIds?: string[];
  decidedBy?: string;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
}
export const EvalSuiteSchema = z.object({
  id: Id,
  version: z.string(),
  checks: z.array(z.object({ id: Id, description: z.string() })),
});
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;
