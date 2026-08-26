export type OutputAssertion = { type: "output"; required?: string[]; forbidden?: string[] };

export type Assertion =
  | OutputAssertion
  | { type: "filesystem"; changed: string[]; forbiddenChanged?: string[] }
  | { type: "git"; headAdvanced: boolean; nonEmptyCheckpoint: boolean; changedPathsWithinScope?: boolean };

export type EvalCase = {
  id: string;
  role: string;
  scenario: string;
  required: string[];
  forbidden: string[];
  observed: string[];
  assertions: Assertion[];
  state: { changedPaths?: string[]; headAdvanced?: boolean; nonEmptyCheckpoint?: boolean; changedPathsWithinScope?: boolean };
};

export type Score = { recall: number; falsePositiveRate: number; failures: string[] };
