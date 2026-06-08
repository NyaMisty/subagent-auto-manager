import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutput } from "./output.js";
import type { SessionSummary, SubagentRun } from "./types.js";

test("summary output omits runs", () => {
  const output = buildOutput(summary(), [run()], "summary");

  assert.deepEqual(output.summary, {
    running: 0,
    stopped: 0,
    closed: 1,
    total: 1,
    shown: 1
  });
  assert.equal("runs" in output, false);
});

test("compact output keeps agent id, state, and stop reason when stopped", () => {
  const output = buildOutput(summary(), [run()], "compact");
  const [item] = output.runs as Record<string, unknown>[];

  assert.deepEqual(Object.keys(item), ["agentId", "state", "stopReason"]);
  assert.deepEqual(item, {
    agentId: "agent-1",
    state: "closed",
    stopReason: "hook"
  });
});

test("medium output keeps common recall and stats fields", () => {
  const output = buildOutput(summary(), [run()], "medium");
  const [item] = output.runs as Record<string, unknown>[];

  assert.deepEqual(output.summary, {
    running: 0,
    stopped: 0,
    closed: 1,
    total: 1,
    shown: 1
  });
  assert.deepEqual(Object.keys(item), [
    "agentId",
    "agentType",
    "state",
    "prompt",
    "startTime",
    "stopTime",
    "stopReason",
    "closeTime",
    "durationMs",
    "lastAssistantMessage",
    "startArgs",
    "model",
    "cwd"
  ]);
  assert.equal(item.agentId, "agent-1");
  assert.equal(item.state, "closed");
  assert.equal(item.stopReason, "hook");
  assert.equal(item.prompt, "inspect package.json");
  assert.deepEqual(item.startArgs, {
    agent_id: "agent-1",
    agent_type: "explorer",
    cwd: "D:\\Workspaces\\repo",
    model: "gpt-5.5",
    model_reasoning_effort: "high",
    permission_mode: "bypassPermissions",
    prompt: "inspect package.json"
  });
  assert.equal("runKey" in item, false);
  assert.equal("sessionId" in item, false);
  assert.equal("turnId" in item, false);
  assert.equal("startPayload" in item, false);
  assert.equal("stopPayload" in item, false);
});

test("full output includes all run fields and parsed raw payloads", () => {
  const output = buildOutput(summary(), [run()], "full");
  const [item] = output.runs as Record<string, unknown>[];

  assert.deepEqual(output.summary, {
    sessionId: "session-a",
    running: 0,
    stopped: 0,
    closed: 1,
    total: 1,
    shown: 1
  });
  assert.equal(item.state, "closed");
  assert.equal("status" in item, false);
  assert.equal("closed" in item, false);
  assert.equal(item.runKey, "session-a:agent-1");
  assert.equal(item.sessionId, "session-a");
  assert.equal(item.turnId, "turn-1");
  assert.deepEqual(item.startArgs, {
    agent_id: "agent-1",
    agent_type: "explorer",
    cwd: "D:\\Workspaces\\repo",
    model: "gpt-5.5",
    model_reasoning_effort: "high",
    permission_mode: "bypassPermissions",
    prompt: "inspect package.json"
  });
  assert.equal(item.transcriptPath, "parent.jsonl");
  assert.equal(item.agentTranscriptPath, "agent.jsonl");
  assert.deepEqual(item.startPayload, {
    hook_event_name: "SubagentStart",
    extra_field: {
      nested: true
    }
  });
  assert.deepEqual(item.stopPayload, {
    hook_event_name: "SubagentStop",
    last_assistant_message: "done"
  });
  assert.deepEqual(item.closePayload, {
    hook_event_name: "PostToolUse",
    tool_name: "close_agent"
  });
});

function summary(): SessionSummary {
  return {
    sessionId: "session-a",
    running: 0,
    stopped: 0,
    closed: 1,
    total: 1
  };
}

function run(): SubagentRun {
  return {
    runKey: "session-a:agent-1",
    subagentId: "agent-1",
    agentId: "agent-1",
    agentType: "explorer",
    sessionId: "session-a",
    hookParentPid: 12345,
    hookSessionPid: 9000,
    turnId: "turn-1",
    permissionMode: "bypassPermissions",
    model: "gpt-5.5",
    cwd: "D:\\Workspaces\\repo",
    transcriptPath: "parent.jsonl",
    agentTranscriptPath: "agent.jsonl",
    startEventId: 1,
    stopEventId: 2,
    startTime: "2026-06-02T17:08:29.524Z",
    stopTime: "2026-06-02T17:08:41.925Z",
    status: "stopped",
    closed: true,
    closeEventId: 3,
    closeTime: "2026-06-02T17:08:42.000Z",
    durationMs: 12401,
    prompt: "inspect package.json",
    lastAssistantMessage: "done",
    startArgs:
      "{\"agent_id\":\"agent-1\",\"agent_type\":\"explorer\",\"cwd\":\"D:\\\\Workspaces\\\\repo\",\"model\":\"gpt-5.5\",\"model_reasoning_effort\":\"high\",\"permission_mode\":\"bypassPermissions\",\"prompt\":\"inspect package.json\"}",
    startPayload: "{\"hook_event_name\":\"SubagentStart\",\"extra_field\":{\"nested\":true}}",
    stopPayload: "{\"hook_event_name\":\"SubagentStop\",\"last_assistant_message\":\"done\"}",
    closePayload: "{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"close_agent\"}"
  };
}
