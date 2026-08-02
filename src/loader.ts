import { realpath, readFile, readdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { parse } from "yaml";
import {
  AgentDefinitionSchema,
  SkillDefinitionSchema,
  WorkflowDefinitionSchema,
  type AgentDefinition,
  type SkillDefinition,
  type WorkflowDefinition,
} from "./domain.js";

export class UnsafePathError extends Error {
  readonly code = "UNSAFE_PATH";
}
export async function safeResolve(root: string, candidate: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, candidate);
  const parent = await realpath(dirname(target));
  if (parent !== canonicalRoot && !parent.startsWith(`${canonicalRoot}${sep}`))
    throw new UnsafePathError(`Path escapes definition root: ${candidate}`);
  const canonicalTarget = await realpath(target);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${sep}`))
    throw new UnsafePathError(`Symlink escapes definition root: ${candidate}`);
  return canonicalTarget;
}
export async function loadYaml<T>(
  root: string,
  candidate: string,
  parser: { parse(value: unknown): T },
): Promise<T> {
  const path = await safeResolve(root, candidate);
  return parser.parse(parse(await readFile(path, "utf8")));
}
export const loadAgent = (root: string, file: string): Promise<AgentDefinition> =>
  loadYaml(root, file, AgentDefinitionSchema);
export const loadWorkflow = (root: string, file: string): Promise<WorkflowDefinition> =>
  loadYaml(root, file, WorkflowDefinitionSchema);
export async function loadSkills(root: string): Promise<SkillDefinition[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const skills: SkillDefinition[] = [];
  for (const entry of entries.filter((x) => x.isDirectory())) {
    const path = await safeResolve(root, `${entry.name}/SKILL.md`);
    const text = await readFile(path, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/u.exec(text);
    if (!match) throw new Error(`Malformed skill ${entry.name}: YAML frontmatter required`);
    skills.push(
      SkillDefinitionSchema.parse({ ...parse(match[1]!), instructions: match[2]!.trim() }),
    );
  }
  return skills;
}
