import type {
  AgentDefinition,
  ApprovalRequest,
  ArtifactInstance,
  AgentEvent,
  SkillDefinition,
  StageRun,
  WorkflowRun,
} from "./domain.js";

export interface FactoryRepositories {
  workflowRuns: {
    get(id: string): Promise<WorkflowRun | undefined>;
    save(run: WorkflowRun): Promise<void>;
  };
  stageRuns: {
    list(workflowRunId: string): Promise<StageRun[]>;
    save(workflowRunId: string, stage: StageRun): Promise<void>;
  };
  events: {
    append(workflowRunId: string, event: AgentEvent): Promise<void>;
    list(workflowRunId: string): Promise<AgentEvent[]>;
  };
  artifacts: {
    save(workflowRunId: string, artifact: ArtifactInstance): Promise<void>;
    list(workflowRunId: string): Promise<ArtifactInstance[]>;
    replace(workflowRunId: string, artifacts: ArtifactInstance[]): Promise<void>;
  };
  approvals: {
    get(id: string): Promise<ApprovalRequest | undefined>;
    save(approval: ApprovalRequest): Promise<void>;
    list(workflowRunId: string): Promise<ApprovalRequest[]>;
  };
  agents: {
    get(id: string): Promise<AgentDefinition | undefined>;
    put(agent: AgentDefinition): Promise<void>;
  };
  skills: {
    get(id: string): Promise<SkillDefinition | undefined>;
    put(skill: SkillDefinition): Promise<void>;
  };
}

export class InMemoryRepositories implements FactoryRepositories {
  private runs = new Map<string, WorkflowRun>();
  private stages = new Map<string, StageRun[]>();
  private eventLog = new Map<string, AgentEvent[]>();
  private artifactLog = new Map<string, ArtifactInstance[]>();
  private approvalLog = new Map<string, ApprovalRequest>();
  private agentLog = new Map<string, AgentDefinition>();
  private skillLog = new Map<string, SkillDefinition>();
  workflowRuns = {
    get: async (id: string) => this.runs.get(id),
    save: async (run: WorkflowRun) => {
      this.runs.set(run.id, structuredClone(run));
    },
  };
  stageRuns = {
    list: async (id: string) => structuredClone(this.stages.get(id) ?? []),
    save: async (id: string, stage: StageRun) => {
      const all = this.stages.get(id) ?? [];
      this.stages.set(id, [...all.filter((x) => x.id !== stage.id), structuredClone(stage)]);
    },
  };
  events = {
    append: async (id: string, event: AgentEvent) => {
      this.eventLog.set(id, [...(this.eventLog.get(id) ?? []), structuredClone(event)]);
    },
    list: async (id: string) => structuredClone(this.eventLog.get(id) ?? []),
  };
  artifacts = {
    save: async (id: string, artifact: ArtifactInstance) => {
      this.artifactLog.set(id, [...(this.artifactLog.get(id) ?? []), structuredClone(artifact)]);
    },
    list: async (id: string) => structuredClone(this.artifactLog.get(id) ?? []),
    replace: async (id: string, artifacts: ArtifactInstance[]) => {
      this.artifactLog.set(id, structuredClone(artifacts));
    },
  };
  approvals = {
    get: async (id: string) => this.approvalLog.get(id),
    save: async (a: ApprovalRequest) => {
      this.approvalLog.set(a.id, structuredClone(a));
    },
    list: async (id: string) =>
      structuredClone([...this.approvalLog.values()].filter((x) => x.workflowRunId === id)),
  };
  agents = {
    get: async (id: string) => this.agentLog.get(id),
    put: async (a: AgentDefinition) => {
      this.agentLog.set(a.metadata.id, structuredClone(a));
    },
  };
  skills = {
    get: async (id: string) => this.skillLog.get(id),
    put: async (s: SkillDefinition) => {
      this.skillLog.set(s.name, structuredClone(s));
    },
  };
}
