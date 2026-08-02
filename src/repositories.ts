import type {
  AgentDefinition,
  ApprovalRequest,
  ArtifactInstance,
  AgentEvent,
  SkillDefinition,
  StageRun,
  WorkflowRun,
} from "./domain.js";
import { createRequire } from "node:module";
import type { DatabaseSync, DatabaseSync as DatabaseSyncConstructor } from "node:sqlite";

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

/** Durable repository backed by a single SQLite database.
 *
 * Values are stored as their validated JSON representation while indexed columns
 * keep the append-only logs and per-run lookups deterministic. Every mutation is
 * committed in a transaction so an interrupted process never leaves a partially
 * replaced collection behind.
 */
export class SqliteRepositories implements FactoryRepositories {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: typeof DatabaseSyncConstructor;
    };
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stage_runs (
        workflow_run_id TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (workflow_run_id, id)
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, workflow_run_id TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, workflow_run_id TEXT NOT NULL,
        id TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (workflow_run_id, id)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, workflow_run_id TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_by_run ON events(workflow_run_id, sequence);
      CREATE INDEX IF NOT EXISTS artifacts_by_run ON artifacts(workflow_run_id, sequence);
      CREATE INDEX IF NOT EXISTS approvals_by_run ON approvals(workflow_run_id);
    `);
  }

  close(): void {
    this.database.close();
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private get<T>(table: string, id: string): T | undefined {
    const row = this.database.prepare(`SELECT value FROM ${table} WHERE id = ?`).get(id) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  private put(table: string, id: string, value: unknown): void {
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO ${table} (id, value) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
        )
        .run(id, JSON.stringify(value));
    });
  }

  workflowRuns = {
    get: async (id: string) => this.get<WorkflowRun>("workflow_runs", id),
    save: async (run: WorkflowRun) => this.put("workflow_runs", run.id, run),
  };
  stageRuns = {
    list: async (id: string) =>
      (
        this.database
          .prepare("SELECT value FROM stage_runs WHERE workflow_run_id = ? ORDER BY rowid")
          .all(id) as Array<{ value: string }>
      ).map((row) => JSON.parse(row.value) as StageRun),
    save: async (id: string, stage: StageRun) => {
      this.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO stage_runs (workflow_run_id, id, value) VALUES (?, ?, ?)
             ON CONFLICT(workflow_run_id, id) DO UPDATE SET value = excluded.value`,
          )
          .run(id, stage.id, JSON.stringify(stage));
      });
    },
  };
  events = {
    append: async (id: string, event: AgentEvent) => {
      this.transaction(() => {
        this.database
          .prepare("INSERT INTO events (workflow_run_id, value) VALUES (?, ?)")
          .run(id, JSON.stringify(event));
      });
    },
    list: async (id: string) =>
      (
        this.database
          .prepare("SELECT value FROM events WHERE workflow_run_id = ? ORDER BY sequence")
          .all(id) as Array<{ value: string }>
      ).map((row) => JSON.parse(row.value) as AgentEvent),
  };
  artifacts = {
    save: async (id: string, artifact: ArtifactInstance) => {
      this.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO artifacts (workflow_run_id, id, value) VALUES (?, ?, ?)
             ON CONFLICT(workflow_run_id, id) DO UPDATE SET value = excluded.value`,
          )
          .run(id, artifact.id, JSON.stringify(artifact));
      });
    },
    list: async (id: string) =>
      (
        this.database
          .prepare("SELECT value FROM artifacts WHERE workflow_run_id = ? ORDER BY sequence")
          .all(id) as Array<{ value: string }>
      ).map((row) => JSON.parse(row.value) as ArtifactInstance),
    replace: async (id: string, artifacts: ArtifactInstance[]) => {
      this.transaction(() => {
        this.database.prepare("DELETE FROM artifacts WHERE workflow_run_id = ?").run(id);
        const insert = this.database.prepare(
          "INSERT INTO artifacts (workflow_run_id, id, value) VALUES (?, ?, ?)",
        );
        for (const artifact of artifacts) insert.run(id, artifact.id, JSON.stringify(artifact));
      });
    },
  };
  approvals = {
    get: async (id: string) => this.get<ApprovalRequest>("approvals", id),
    save: async (approval: ApprovalRequest) => {
      this.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO approvals (id, workflow_run_id, value) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET workflow_run_id = excluded.workflow_run_id,
               value = excluded.value`,
          )
          .run(approval.id, approval.workflowRunId, JSON.stringify(approval));
      });
    },
    list: async (id: string) =>
      (
        this.database
          .prepare("SELECT value FROM approvals WHERE workflow_run_id = ? ORDER BY rowid")
          .all(id) as Array<{ value: string }>
      ).map((row) => JSON.parse(row.value) as ApprovalRequest),
  };
  agents = {
    get: async (id: string) => this.get<AgentDefinition>("agents", id),
    put: async (agent: AgentDefinition) => this.put("agents", agent.metadata.id, agent),
  };
  skills = {
    get: async (id: string) => this.get<SkillDefinition>("skills", id),
    put: async (skill: SkillDefinition) => this.put("skills", skill.name, skill),
  };
}
