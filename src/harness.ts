import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  AgentDefinition,
  AgentEvent,
  HarnessCapabilities,
  ModelProfile,
  SkillDefinition,
  TaskEnvelope,
} from "./domain.js";
import { AgentEventSchema } from "./domain.js";

export interface MaterializeHarnessInput {
  agent: AgentDefinition;
  skills: SkillDefinition[];
  modelProfile: ModelProfile;
  destination: string;
}
export interface MaterializedHarnessConfig {
  harnessId: string;
  files: Array<{ path: string; content: string }>;
  model: string;
}
export interface HarnessRunInput {
  runId: string;
  task: TaskEnvelope;
  config: MaterializedHarnessConfig;
}
export interface HarnessAdapter {
  readonly id: string;
  inspectCapabilities(): Promise<HarnessCapabilities>;
  materialize(input: MaterializeHarnessInput): Promise<MaterializedHarnessConfig>;
  run(input: HarnessRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}

export class HarnessCompatibilityError extends Error {
  readonly code = "HARNESS_INCOMPATIBLE";
  constructor(
    public readonly harnessId: string,
    public readonly missingCapabilities: string[],
  ) {
    super(`Harness ${harnessId} lacks required capabilities: ${missingCapabilities.join(", ")}`);
  }
}
export async function assertHarnessCompatibility(
  adapter: HarnessAdapter,
  required: string[],
): Promise<void> {
  const capabilities = await adapter.inspectCapabilities();
  const missing = required.filter(
    (key) => !(key in capabilities) || !capabilities[key as keyof HarnessCapabilities],
  );
  if (missing.length) throw new HarnessCompatibilityError(adapter.id, missing);
}

const allCapabilities: HarnessCapabilities = {
  subagents: true,
  nestedSubagents: false,
  skills: true,
  mcp: true,
  structuredOutput: true,
  backgroundExecution: false,
  nativeWorktrees: false,
};
type Script = (input: HarnessRunInput, invocation: number) => AgentEvent[];
export class ScriptedHarnessAdapter implements HarnessAdapter {
  readonly id = "scripted";
  private invocations = new Map<string, number>();
  private cancelled = new Set<string>();
  constructor(
    private readonly scripts: Record<string, Script>,
    private readonly capabilities: HarnessCapabilities = allCapabilities,
  ) {}
  async inspectCapabilities(): Promise<HarnessCapabilities> {
    return this.capabilities;
  }
  async materialize(input: MaterializeHarnessInput): Promise<MaterializedHarnessConfig> {
    return materialize(this.id, "scripted", input);
  }
  async *run(input: HarnessRunInput): AsyncIterable<AgentEvent> {
    const key = input.task.stageId;
    const count = (this.invocations.get(key) ?? 0) + 1;
    this.invocations.set(key, count);
    const script = this.scripts[key];
    if (!script) throw new Error(`No script for stage ${key}`);
    for (const event of script(input, count)) {
      if (this.cancelled.has(input.runId)) return;
      yield event;
    }
  }
  async cancel(runId: string): Promise<void> {
    this.cancelled.add(runId);
  }
}

export interface ProcessHarnessCommand {
  executable: string;
  arguments?: string[];
  cwd?: string;
  timeoutMilliseconds?: number;
}

/** Executes a harness as a real local process using JSON on stdin and NDJSON events on stdout. */
export class ProcessHarnessAdapter implements HarnessAdapter {
  readonly id = "process";
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly command: ProcessHarnessCommand) {}

  async inspectCapabilities(): Promise<HarnessCapabilities> {
    return {
      subagents: false,
      nestedSubagents: false,
      skills: true,
      mcp: false,
      structuredOutput: true,
      backgroundExecution: true,
      nativeWorktrees: false,
    };
  }

  async materialize(input: MaterializeHarnessInput): Promise<MaterializedHarnessConfig> {
    return materialize(this.id, ".agent-factory/generated/process", input);
  }

  async *run(input: HarnessRunInput): AsyncIterable<AgentEvent> {
    const child = spawn(this.command.executable, this.command.arguments ?? [], {
      cwd: this.command.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.children.set(input.runId, child);
    child.stdin.end(JSON.stringify(input));
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    const timeout = setTimeout(
      () => child.kill("SIGTERM"),
      this.command.timeoutMilliseconds ?? 60_000,
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => {
      clearTimeout(timeout);
      this.children.delete(input.runId);
    });
    if (exitCode !== 0)
      throw new Error(
        `Harness process exited with ${String(exitCode)}${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
      yield AgentEventSchema.parse(JSON.parse(line));
    }
  }

  async cancel(runId: string): Promise<void> {
    this.children.get(runId)?.kill("SIGTERM");
  }
}

abstract class ExternalHarnessScaffold implements HarnessAdapter {
  abstract readonly id: string;
  abstract inspectCapabilities(): Promise<HarnessCapabilities>;
  abstract nativeDirectory(): string;
  async materialize(input: MaterializeHarnessInput): Promise<MaterializedHarnessConfig> {
    return materialize(this.id, this.nativeDirectory(), input);
  }
  run(input: HarnessRunInput): AsyncIterableIterator<AgentEvent> {
    void input;
    const error = new UnsupportedHarnessOperationError(this.id, "run");
    const iterator: AsyncIterableIterator<AgentEvent> = {
      next: () => Promise.reject(error),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return iterator;
  }
  async cancel(runId: string): Promise<void> {
    void runId;
    throw new UnsupportedHarnessOperationError(this.id, "cancel");
  }
}
export class UnsupportedHarnessOperationError extends Error {
  readonly code = "HARNESS_OPERATION_UNSUPPORTED";
  constructor(harness: string, operation: string) {
    super(`${harness} adapter does not yet support ${operation}`);
  }
}

const scaffoldCapabilities: HarnessCapabilities = {
  subagents: false,
  nestedSubagents: false,
  skills: true,
  mcp: false,
  structuredOutput: false,
  backgroundExecution: false,
  nativeWorktrees: false,
};
export class CodexHarnessAdapter extends ExternalHarnessScaffold {
  readonly id = "codex";
  nativeDirectory() {
    return ".codex/agents";
  }
  async inspectCapabilities() {
    return { ...scaffoldCapabilities, mcp: true, structuredOutput: true };
  }
}
export class ClaudeCodeHarnessAdapter extends ExternalHarnessScaffold {
  readonly id = "claude-code";
  nativeDirectory() {
    return ".claude/agents";
  }
  async inspectCapabilities() {
    return { ...scaffoldCapabilities, subagents: true };
  }
}
export class OpenCodeHarnessAdapter extends ExternalHarnessScaffold {
  readonly id = "opencode";
  nativeDirectory() {
    return ".opencode/agents";
  }
  async inspectCapabilities() {
    return scaffoldCapabilities;
  }
}

function materialize(
  harnessId: string,
  directory: string,
  input: MaterializeHarnessInput,
): MaterializedHarnessConfig {
  const provider = input.modelProfile.providers[harnessId];
  if (!provider)
    throw new HarnessCompatibilityError(harnessId, [`model profile ${input.modelProfile.id}`]);
  return {
    harnessId,
    model: provider.model,
    files: [
      {
        path: `${directory}/${input.agent.metadata.id}.md`,
        content: `# ${input.agent.metadata.displayName}\n\n${input.agent.spec.description}\n\nSkills: ${input.skills.map((s) => s.name).join(", ")}\n`,
      },
    ],
  };
}
