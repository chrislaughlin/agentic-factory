import type { EvalCase, Score } from "../types.js";

export function scoreOutput(testCase: EvalCase): Score {
  const required = new Set(testCase.required);
  const forbidden = new Set(testCase.forbidden);
  const observed = new Set(testCase.observed);
  const missing = [...required].filter((id) => !observed.has(id));
  const falsePositives = [...forbidden].filter((id) => observed.has(id));
  return {
    recall: required.size === 0 ? 1 : (required.size - missing.length) / required.size,
    falsePositiveRate: observed.size === 0 ? 0 : falsePositives.length / observed.size,
    failures: [
      ...(missing.length ? [`missed required outcomes: ${missing.join(", ")}`] : []),
      ...(falsePositives.length ? [`forbidden outcomes observed: ${falsePositives.join(", ")}`] : []),
    ],
  };
}
