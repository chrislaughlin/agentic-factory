import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreOutput } from "./assertions/output.js";
import { checkFilesystem } from "./assertions/filesystem.js";
import { checkGit } from "./assertions/git.js";
import { runCodex } from "./harnesses/codex.js";
import type { EvalCase } from "./types.js";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "..");

function fail(message: string): never { throw new Error(message); }

function validateCase(value: unknown, index: number): EvalCase {
  if (!value || typeof value !== "object") fail(`case ${index}: expected object`);
  const item = value as Partial<EvalCase>;
  for (const key of ["id", "role", "scenario", "required", "forbidden", "observed", "assertions", "state"] as const) {
    if (!(key in item)) fail(`case ${index}: missing ${key}`);
  }
  for (const key of ["required", "forbidden", "observed"] as const) if (!Array.isArray(item[key]) || item[key].some((id) => typeof id !== "string")) fail(`case ${index}: ${key} must be string[]`);
  if (typeof item.id !== "string" || typeof item.role !== "string" || typeof item.scenario !== "string") fail(`case ${index}: id, role, and scenario must be strings`);
  if (!Array.isArray(item.assertions) || item.assertions.some((assertion) => {
    if (!assertion || typeof assertion !== "object" || !("type" in assertion)) return true;
    const type = (assertion as { type?: unknown }).type;
    return type !== "output" && type !== "filesystem" && type !== "git";
  })) fail(`case ${index}: assertions contain an invalid type`);
  if (!item.state || typeof item.state !== "object") fail(`case ${index}: state must be an object`);
  return item as EvalCase;
}

async function loadCases(): Promise<EvalCase[]> {
  const cases = JSON.parse(await readFile(resolve(root, "cases/cases.json"), "utf8"));
  if (!Array.isArray(cases)) fail("cases.json must contain an array");
  return cases.map(validateCase);
}

async function manifestRoles(): Promise<string[]> {
  const manifest = JSON.parse(await readFile(resolve(repository, "agents/manifest.json"), "utf8"));
  return Object.keys(manifest.roles ?? {});
}

async function main(): Promise<void> {
  let cases = await loadCases();
  const ids = new Set<string>();
  for (const testCase of cases) {
    if (ids.has(testCase.id)) fail(`duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
  }
  const roles = await manifestRoles();
  const covered = new Set(cases.map((testCase) => testCase.role));
  for (const role of roles) if (!covered.has(role)) fail(`manifest role lacks eval coverage: ${role}`);
  for (const role of ["shape-work", "do-work"]) if (!covered.has(role)) fail(`orchestration role lacks eval coverage: ${role}`);
  if (process.argv.includes("--live")) cases = (await Promise.all(cases.map(runCodex))).map(validateCase);

  let failures = 0;
  for (const testCase of cases) {
    const output = scoreOutput(testCase);
    const errors = [...output.failures, ...checkFilesystem(testCase), ...checkGit(testCase)];
    if (errors.length) failures++;
    console.log(`${testCase.role}/${testCase.id} ${errors.length ? "FAIL" : "PASS"} recall=${output.recall.toFixed(2)} false_positive_rate=${output.falsePositiveRate.toFixed(2)}`);
    for (const error of errors) console.error(`  ERROR: ${error}`);
  }
  console.log(`Roles: ${roles.length}/${roles.length} covered; cases: ${cases.length - failures} passed, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
