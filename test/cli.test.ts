import { describe, expect, it } from "vitest";
import { CliExitCode, runCli, type CliIo, type OperatorBackend } from "../src/cli.js";

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: CliIo & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    writeOut: (line) => stdout.push(line),
    writeError: (line) => stderr.push(line),
  };
  return value;
}

function backend(): OperatorBackend {
  return {
    work: async () => ({
      runId: "workflow-1",
      status: "waiting-approval",
      approvalId: "approval-1",
    }),
    list: async () => [{ id: "workflow-1", status: "waiting-approval", objective: "Ship it" }],
    inspect: async () => ({
      id: "workflow-1",
      status: "escalated",
      escalationReason: "retry limit",
    }),
    getApproval: async () => ({
      id: "approval-1",
      kind: "final",
      revision: "head-123",
      evidenceArtifactIds: ["ci-1", "review-1"],
      status: "pending",
    }),
    answer: async () => ({ requestId: "request-1", status: "answered" }),
    approve: async () => ({ runId: "workflow-1", status: "deploying" }),
    reject: async () => ({ runId: "workflow-1", status: "cancelled" }),
    retry: async () => ({ runId: "workflow-1", status: "running" }),
    cancel: async () => ({ runId: "workflow-1", status: "cancelled" }),
    resume: async () => ({ runId: "workflow-1", status: "running" }),
    harnesses: async () => [{ id: "process", ready: true }],
    doctor: async () => ({ ready: false, checks: [{ name: "deployment", ready: false }] }),
  };
}

describe("operator CLI", () => {
  it("returns versioned JSON and a stable pending-approval exit code for work submission", async () => {
    const output = io();
    const code = await runCli(
      ["work", "Ship the feature", "--harness", "process", "--workflow", "local-sdlc", "--json"],
      backend(),
      output,
    );

    expect(code).toBe(CliExitCode.PendingApproval);
    expect(JSON.parse(output.stdout[0]!)).toMatchObject({
      apiVersion: "agent-factory.dev/cli/v1",
      kind: "WorkSubmission",
      data: { runId: "workflow-1", status: "waiting-approval", approvalId: "approval-1" },
    });
  });

  it("shows the exact final-approval revision/evidence and requires explicit confirmation", async () => {
    const preview = io();
    const refused = await runCli(["approve", "approval-1", "--json"], backend(), preview);
    expect(refused).toBe(CliExitCode.ValidationFailure);
    expect(JSON.parse(preview.stderr[0]!)).toMatchObject({
      error: {
        code: "CONFIRMATION_REQUIRED",
        revision: "head-123",
        evidenceArtifactIds: ["ci-1", "review-1"],
      },
    });

    const confirmed = io();
    const approved = await runCli(
      ["approve", "approval-1", "--yes", "--json"],
      backend(),
      confirmed,
    );
    expect(approved).toBe(CliExitCode.Success);
    expect(JSON.parse(confirmed.stdout[0]!)).toMatchObject({ data: { status: "deploying" } });
  });

  it("supports workflow controls and uses stable failure categories", async () => {
    const cancellation = io();
    expect(await runCli(["cancel", "workflow-1"], backend(), cancellation)).toBe(
      CliExitCode.ValidationFailure,
    );
    expect(await runCli(["cancel", "workflow-1", "--yes"], backend(), io())).toBe(
      CliExitCode.Success,
    );
    expect(await runCli(["retry", "workflow-1", "--stage", "qa"], backend(), io())).toBe(
      CliExitCode.Success,
    );
    expect(await runCli(["resume", "workflow-1"], backend(), io())).toBe(CliExitCode.Success);
    expect(await runCli(["answer", "request-1", "--value", "yes"], backend(), io())).toBe(
      CliExitCode.Success,
    );
    expect(await runCli(["doctor", "--json"], backend(), io())).toBe(
      CliExitCode.UnavailableDependency,
    );
    const inspected = io();
    expect(await runCli(["inspect", "workflow-1"], backend(), inspected)).toBe(
      CliExitCode.TerminalFailure,
    );
    expect(inspected.stdout.join("\n")).toContain("ESCALATED");
  });
});
