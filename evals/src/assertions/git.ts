import type { EvalCase } from "../types.js";

export function checkGit(testCase: EvalCase): string[] {
  const failures: string[] = [];
  for (const assertion of testCase.assertions) {
    if (assertion.type !== "git") continue;
    if (testCase.state.headAdvanced !== assertion.headAdvanced) failures.push("unexpected Git HEAD advancement");
    if (testCase.state.nonEmptyCheckpoint !== assertion.nonEmptyCheckpoint) failures.push("unexpected checkpoint diff state");
    if (assertion.changedPathsWithinScope !== undefined && testCase.state.changedPathsWithinScope !== assertion.changedPathsWithinScope) {
      failures.push("changed paths are outside the approved scope");
    }
  }
  return failures;
}
