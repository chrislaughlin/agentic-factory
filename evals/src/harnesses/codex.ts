import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvalCase } from "../types.js";

const execFileAsync = promisify(execFile);

/** Optional adapter: configure CODEX_EVAL_COMMAND to a local JSON-producing launcher. */
export async function runCodex(testCase: EvalCase): Promise<EvalCase> {
  const command = process.env.CODEX_EVAL_COMMAND;
  if (!command) throw new Error("live Codex evals require CODEX_EVAL_COMMAND; fast evals do not require credentials");
  const { stdout } = await execFileAsync(command, [JSON.stringify(testCase)], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as EvalCase;
}
