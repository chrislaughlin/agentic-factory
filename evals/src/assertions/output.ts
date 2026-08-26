import type { EvalCase, Score } from "../types.js";

export function scoreOutput(testCase: EvalCase): Score {
  const outputAssertions = (testCase.assertions ?? []).filter((assertion) => assertion.type === "output");
  const required = new Set(
    outputAssertions.length ? outputAssertions.flatMap((assertion) => assertion.required ?? []) : testCase.required,
  );
  const forbidden = new Set(
    outputAssertions.length ? outputAssertions.flatMap((assertion) => assertion.forbidden ?? []) : testCase.forbidden,
  );
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
