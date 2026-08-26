import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvalCase } from "../types.js";

const execFileAsync = promisify(execFile);

type LiveResult = Pick<EvalCase, "observed" | "state"> & Partial<Pick<
  EvalCase,
  "id" | "role" | "scenario" | "required" | "forbidden" | "assertions"
>>;

type LivePromptInput = Pick<EvalCase, "id" | "role" | "scenario">;

function fail(message: string): never {
  throw new Error(`live Codex result rejected: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObservedState(value: unknown): value is EvalCase["state"] {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(["changedPaths", "headAdvanced", "nonEmptyCheckpoint", "changedPathsWithinScope"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (value.changedPaths !== undefined && !isStringArray(value.changedPaths)) return false;
  return ["headAdvanced", "nonEmptyCheckpoint", "changedPathsWithinScope"].every(
    (key) => value[key] === undefined || typeof value[key] === "boolean",
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateLiveResult(value: unknown, testCase: EvalCase): LiveResult {
  if (!isRecord(value)) fail("expected a JSON object");
  if (!isStringArray(value.observed)) fail("observed must be string[]");
  if (!isObservedState(value.state)) fail("state contains invalid observed filesystem/Git state");

  for (const key of ["id", "role", "scenario", "required", "forbidden", "assertions"] as const) {
    if (key in value && !sameValue(value[key], testCase[key])) {
      fail(`immutable field ${key} differs from fixture ${testCase.id}`);
    }
  }

  return { observed: value.observed, state: value.state };
}

/** Optional adapter: configure CODEX_EVAL_COMMAND to a local JSON-producing launcher. */
export async function runCodex(testCase: EvalCase): Promise<EvalCase> {
  const command = process.env.CODEX_EVAL_COMMAND;
  if (!command) throw new Error("live Codex evals require CODEX_EVAL_COMMAND; fast evals do not require credentials");
  const promptInput: LivePromptInput = {
    id: testCase.id,
    role: testCase.role,
    scenario: testCase.scenario,
  };
  const { stdout } = await execFileAsync(command, [JSON.stringify(promptInput)], { maxBuffer: 1024 * 1024 });
  const result = validateLiveResult(JSON.parse(stdout) as unknown, testCase);
  return { ...testCase, observed: result.observed, state: result.state };
}
