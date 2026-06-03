import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatSession } from "./format.js";
import type { SessionSummary, SubagentRun } from "./types.js";

test("formats optional compact human-readable session output", () => {
  const summary: SessionSummary = {
    sessionId: "019e87b0-d695-7902-96e1-9672e0a12db6",
    running: 1,
    stopped: 1,
    closed: 1,
    total: 2
  };
  const runs: SubagentRun[] = [
    run({ agentId: "agent-running", status: "running", prompt: "review files and report issues" }),
    run({ agentId: "agent-stopped", status: "stopped", stopTime: "2026-06-02T00:00:02.000Z", closed: true })
  ];

  assert.equal(
    formatSession(summary, runs, { now: new Date("2026-06-02T00:00:03.000Z") }),
    [
      "session 019e87b0 total=2 running=1 stopped=1 closed=1",
      "RUN agent-ru general 3s review files and report issues",
      "CLOSED agent-st general 2s",
      ""
    ].join("\n")
  );
});

test("formats durations", () => {
  assert.equal(formatDuration(12), "12ms");
  assert.equal(formatDuration(1_200), "1s");
  assert.equal(formatDuration(62_000), "1m2s");
  assert.equal(formatDuration(7_200_000), "2h");
});

function run(overrides: Partial<SubagentRun>): SubagentRun {
  return {
    runKey: `session:${overrides.agentId ?? "agent"}`,
    subagentId: overrides.agentId ?? "agent",
    agentId: overrides.agentId ?? "agent",
    agentType: "general",
    sessionId: "session",
    turnId: "turn",
    permissionMode: "default",
    model: "gpt-5",
    cwd: null,
    transcriptPath: null,
    agentTranscriptPath: null,
    startEventId: 1,
    stopEventId: overrides.status === "stopped" ? 2 : null,
    startTime: "2026-06-02T00:00:00.000Z",
    stopTime: overrides.stopTime ?? null,
    status: overrides.status ?? "running",
    closed: overrides.closed ?? false,
    closeEventId: overrides.closed ? 3 : null,
    closeTime: overrides.closed ? "2026-06-02T00:00:03.000Z" : null,
    durationMs: null,
    prompt: overrides.prompt ?? null,
    lastAssistantMessage: null,
    startPayload: "{}",
    stopPayload: overrides.status === "stopped" ? "{}" : null,
    closePayload: overrides.closed ? "{}" : null
  };
}
