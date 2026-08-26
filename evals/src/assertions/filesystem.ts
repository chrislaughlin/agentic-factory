import type { EvalCase } from "../types.js";

export function checkFilesystem(testCase: EvalCase): string[] {
  const changed = new Set(testCase.state.changedPaths ?? []);
  const failures: string[] = [];
  for (const assertion of testCase.assertions) {
    if (assertion.type !== "filesystem") continue;
    for (const path of assertion.changed) if (!changed.has(path)) failures.push(`missing changed path: ${path}`);
    for (const path of assertion.forbiddenChanged ?? []) if (changed.has(path)) failures.push(`forbidden changed path: ${path}`);
  }
  return failures;
}
