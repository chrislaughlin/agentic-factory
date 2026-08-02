#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  AgentDefinitionSchema,
  ModelProfileSchema,
  type AgentEvent,
  type ArtifactInstance,
} from "./domain.js";
import { ScriptedHarnessAdapter } from "./harness.js";
import { loadAgent, loadSkills, loadWorkflow } from "./loader.js";
import { InMemoryRepositories } from "./repositories.js";
import { WorkflowEngine } from "./workflow.js";

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals[0] !== "run") {
  console.error("Usage: pnpm agent-factory run [work-item.yaml]");
  process.exitCode = 1;
} else await runDemo();

async function runDemo() {
  const root = resolve(".");
  const workflow = await loadWorkflow(resolve(root, ".agent-factory/workflows"), "local-sdlc.yaml");
  const skills = await loadSkills(resolve(root, ".agents/skills"));
  const agentIds = ["planner", "constructor", "tester", "code-reviewer"];
  const agents = await Promise.all(
    agentIds.map((id) => loadAgent(resolve(root, ".agent-factory/agents"), `${id}.yaml`)),
  );
  const repositories = new InMemoryRepositories();
  for (const agent of agents) await repositories.agents.put(agent);
  for (const skill of skills) await repositories.skills.put(skill);
  let revision = 0;
  const adapter = new ScriptedHarnessAdapter({
    planning: ({ runId }) =>
      completed(
        runId,
        artifact("implementation-plan", "planning", "planner", "initial", {
          summary: "Implement requested change",
          steps: ["change", "test", "review"],
          acceptanceCriteria: ["tests pass"],
        }),
      ),
    construction: ({ runId }) => {
      revision++;
      return completed(
        runId,
        artifact("source-change", "construction", "constructor", `revision-${revision}`, {
          revision: `revision-${revision}`,
          changedPaths: ["src/example.ts"],
          changeKind: "source",
        }),
      );
    },
    test: ({ runId, task }) =>
      completed(
        runId,
        artifact("test-report", "test", "tester", task.workspace.revision, {
          revision: task.workspace.revision,
          passed: true,
          tests: 3,
        }),
      ),
    "code-review": ({ runId, task }, attempt) =>
      completed(
        runId,
        artifact("code-review", "code-review", "code-reviewer", task.workspace.revision, {
          revision: task.workspace.revision,
          approved: attempt > 1,
          findings:
            attempt > 1
              ? []
              : [
                  {
                    fingerprint: "missing-edge-case",
                    severity: "medium",
                    title: "Edge case",
                    description: "Handle edge case",
                    resolved: false,
                  },
                ],
        }),
      ),
  });
  const profile = ModelProfileSchema.parse({
    id: "balanced",
    providers: { scripted: { model: "deterministic-script" } },
  });
  const engine = new WorkflowEngine(
    repositories,
    adapter,
    workflow,
    new Map(agents.map((x) => [x.metadata.id, x])),
    new Map(skills.map((x) => [x.name, x])),
    new Map([[profile.id, profile]]),
  );
  const workItemPath = positionals[1] ?? "examples/work-items/example.yaml";
  const { parse } = await import("yaml");
  const { readFile } = await import("node:fs/promises");
  const workItem = parse(await readFile(resolve(root, workItemPath), "utf8")) as {
    objective: string;
  };
  let run = await engine.submit(workItem.objective);
  const approval = (await repositories.approvals.list(run.id))[0];
  if (!approval) throw new Error("Workflow did not request approval");
  console.log(`Plan awaiting approval: ${approval.id}`);
  run = await engine.approve(approval.id, "local-human");
  console.log(
    JSON.stringify(
      {
        run,
        artifacts: await repositories.artifacts.list(run.id),
        events: await repositories.events.list(run.id),
      },
      null,
      2,
    ),
  );
}
function artifact(
  type: string,
  stage: string,
  agent: string,
  sourceRevision: string,
  content: unknown,
): ArtifactInstance {
  return {
    id: `artifact-${randomUUID()}`,
    type,
    version: "v1",
    producingStageId: stage,
    producer: { kind: "agent", id: agent },
    createdAt: new Date().toISOString(),
    inputArtifactIds: [],
    validation: { valid: true, errors: [] },
    content,
    sourceRevision,
  };
}
function completed(runId: string, created: ArtifactInstance): AgentEvent[] {
  const timestamp = new Date().toISOString();
  return [
    { type: "agent.started", runId, agentId: created.producer.id, timestamp },
    { type: "artifact.created", runId, artifactId: created.id, timestamp },
    {
      type: "agent.completed",
      runId,
      result: { status: "succeeded", summary: "script completed", artifact: created },
      timestamp,
    },
  ];
}
