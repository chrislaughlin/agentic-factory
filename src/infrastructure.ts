import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  symlink,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface AllowedCommand {
  id: string;
  executable: string;
  arguments: string[];
  timeoutMilliseconds?: number;
  terminationGraceMilliseconds?: number;
}

export interface CommandEvidence {
  id: string;
  commandId: string;
  executable: string;
  arguments: string[];
  cwd: string;
  revision: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  passed: boolean;
  timedOut: boolean;
}

export interface CommandRunInput {
  cwd: string;
  revision: string;
  environment?: Record<string, string>;
}

export class CommandNotAllowedError extends Error {
  readonly code = "COMMAND_NOT_ALLOWED";
}

export interface DeterministicCommandRunnerOptions {
  commands: AllowedCommand[];
  environment?: Record<string, string>;
  secrets?: string[];
}

/** Runs predeclared executable/argument tuples and returns redacted, auditable evidence. */
export class DeterministicCommandRunner {
  private readonly commands: Map<string, AllowedCommand>;
  private readonly environment: Record<string, string>;
  private readonly secrets: string[];

  constructor(options: DeterministicCommandRunnerOptions) {
    this.commands = new Map(options.commands.map((command) => [command.id, command]));
    this.environment = options.environment ?? {};
    this.secrets = [
      ...(options.secrets ?? []),
      ...Object.entries(this.environment)
        .filter(([name]) => /(token|secret|password|credential|private.?key|api.?key)/iu.test(name))
        .map(([, value]) => value),
    ]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
  }

  async run(commandId: string, input: CommandRunInput): Promise<CommandEvidence> {
    const command = this.commands.get(commandId);
    if (!command) throw new CommandNotAllowedError(`Command is not configured: ${commandId}`);
    const startedAt = new Date().toISOString();
    const safeEnvironment = Object.fromEntries(
      ["PATH", "TMPDIR", "LANG", "LC_ALL", "CI"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const invocationEnvironment = input.environment ?? {};
    const child = spawn(command.executable, command.arguments, {
      cwd: input.cwd,
      env: { ...safeEnvironment, ...this.environment, ...invocationEnvironment },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    const timeout = setTimeout(
      () => {
        timedOut = true;
        terminateCommand(child, "SIGTERM");
        forceKill = setTimeout(
          () => terminateCommand(child, "SIGKILL"),
          command.terminationGraceMilliseconds ?? 1_000,
        );
        forceKill.unref();
      },
      command.timeoutMilliseconds ?? 15 * 60_000,
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
    });
    const invocationSecrets = Object.entries(invocationEnvironment)
      .filter(([name]) => /(token|secret|password|credential|private.?key|api.?key)/iu.test(name))
      .map(([, value]) => value)
      .filter(Boolean);
    const redact = (value: string) =>
      [...this.secrets, ...invocationSecrets].reduce(
        (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
        value,
      );
    return {
      id: `command-${randomUUID()}`,
      commandId,
      executable: command.executable,
      arguments: [...command.arguments],
      cwd: input.cwd,
      revision: input.revision,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      stdout: redact(stdout),
      stderr: redact(stderr),
      passed: exitCode === 0 && !timedOut,
      timedOut,
    };
  }
}

function terminateCommand(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct process if its group has already exited.
    }
  }
  child.kill(signal);
}

export interface IsolatedWorkspace {
  root: string;
  branch: string;
  baseRevision: string;
}

export class WorkspaceLockedError extends Error {
  readonly code = "WORKSPACE_LOCKED";
}

export interface WorkspaceRevisionProvider {
  currentRevision(root: string): Promise<string>;
  isClean(root: string): Promise<boolean>;
}

export class GitWorkspaceRevisionProvider implements WorkspaceRevisionProvider {
  async currentRevision(root: string): Promise<string> {
    const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
    return stdout.trim();
  }

  async isClean(root: string): Promise<boolean> {
    const { stdout } = await execute("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
    });
    return stdout.trim().length === 0;
  }
}

/** Owns one repository-wide writer lock and creates one auditable Git worktree per workflow. */
export class GitWorkspaceManager {
  private readonly repositoryRoot: string;
  private readonly worktreeRoot: string;
  private readonly lockPath: string;
  private lockHandle: FileHandle | undefined;
  private active: { runId: string; root: string } | undefined;

  constructor(options: { repositoryRoot: string; worktreeRoot: string }) {
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.worktreeRoot = resolve(options.worktreeRoot);
    this.lockPath = join(this.worktreeRoot, "repository.lock");
  }

  async prepare(input: { runId: string; baseBranch: string }): Promise<IsolatedWorkspace> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(input.runId))
      throw new Error(`Unsafe workflow run id: ${input.runId}`);
    await mkdir(this.worktreeRoot, { recursive: true });
    try {
      this.lockHandle = await open(this.lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readFile(this.lockPath, "utf8").catch(() => "unknown owner");
      throw new WorkspaceLockedError(`Repository workspace is locked by ${owner}`);
    }
    await this.lockHandle.writeFile(JSON.stringify({ runId: input.runId, pid: process.pid }));
    const root = join(this.worktreeRoot, input.runId);
    const branch = `agent-factory/${input.runId}`;
    let worktreeCreated = false;
    try {
      const { stdout } = await execute("git", ["rev-parse", input.baseBranch], {
        cwd: this.repositoryRoot,
      });
      const baseRevision = stdout.trim();
      await execute("git", ["worktree", "add", "-b", branch, root, input.baseBranch], {
        cwd: this.repositoryRoot,
      });
      worktreeCreated = true;
      const dependencies = join(this.repositoryRoot, "node_modules");
      if (
        await lstat(dependencies)
          .then(() => true)
          .catch(() => false)
      )
        await symlink(dependencies, join(root, "node_modules"), "dir");
      this.active = { runId: input.runId, root };
      return { root, branch, baseRevision };
    } catch (error) {
      if (worktreeCreated) {
        await execute("git", ["worktree", "remove", "--force", root], {
          cwd: this.repositoryRoot,
        }).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
        await execute("git", ["branch", "-D", branch], { cwd: this.repositoryRoot }).catch(
          () => undefined,
        );
      }
      await this.releaseLock();
      throw error;
    }
  }

  async cleanup(runId: string): Promise<void> {
    if (this.active && this.active.runId !== runId)
      throw new Error(`Workflow does not own the active workspace: ${runId}`);
    if (!this.active) {
      const owner = JSON.parse(await readFile(this.lockPath, "utf8")) as { runId?: string };
      if (owner.runId !== runId)
        throw new Error(`Workflow does not own the durable workspace lock: ${runId}`);
    }
    const root = this.active?.root ?? join(this.worktreeRoot, runId);
    try {
      await execute("git", ["worktree", "remove", "--force", root], { cwd: this.repositoryRoot });
      await rm(root, { recursive: true, force: true });
    } finally {
      this.active = undefined;
      await this.releaseLock();
    }
  }

  private async releaseLock(): Promise<void> {
    await this.lockHandle?.close();
    this.lockHandle = undefined;
    await unlink(this.lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
