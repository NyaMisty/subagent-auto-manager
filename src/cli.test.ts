import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SubagentLedger } from "./ledger.js";

test("defaults output to pretty medium JSON filtered to running agents", async () => {
  const root = tempRoot();
  seedRun(root, "session-json", "running");
  seedRun(root, "session-json", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-json" });

  try {
    assert.match(result.stdout, /^\{\n  "summary":/);
    assert.match(result.stderr, /filter=running format=json detail=medium session=session-json shown=1\/2/);
    assert.match(result.stderr, /--all/);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.summary, {
      running: 1,
      stopped: 1,
      closed: 0,
      total: 2,
      shown: 1
    });
    assert.deepEqual(Object.keys(parsed.runs[0]), [
      "agentId",
      "agentType",
      "status",
      "closed",
      "prompt",
      "startTime",
      "stopTime",
      "closeTime",
      "durationMs",
      "lastAssistantMessage",
      "model",
      "cwd"
    ]);
    assert.equal(parsed.runs[0].agentId, "agent-1");
    assert.equal(parsed.runs[0].prompt, "inspect package.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports full JSON list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-full");
  const result = runCli(["--cwd", root, "--all", "--full"], { CODEX_THREAD_ID: "session-full" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.sessionId, "session-full");
    assert.equal(parsed.runs[0].runKey, "session-full:agent-1");
    assert.equal(parsed.runs[0].sessionId, "session-full");
    assert.equal(parsed.runs[0].transcriptPath, join(root, "parent.jsonl"));
    assert.deepEqual(parsed.runs[0].startPayload.extra_field, { nested: true });
    assert.equal(parsed.runs[0].stopPayload.last_assistant_message, "done");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("defaults empty list output to JSON", async () => {
  const root = tempRoot();
  const result = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-empty" });

  try {
    assert.deepEqual(JSON.parse(result.stdout), {
      summary: {
        running: 0,
        stopped: 0,
        closed: 0,
        total: 0,
        shown: 0
      },
      runs: []
    });
    assert.match(result.stderr, /filter=running/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional text list output", async () => {
  const root = tempRoot();
  const result = runCli(["--cwd", root, "--text"], { CODEX_THREAD_ID: "session-text" });

  try {
    assert.equal(result.stdout, "session session-text total=0 running=0 stopped=0 closed=0\nno subagents\n");
    assert.match(result.stderr, /format=text/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional YAML list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-yaml");
  const result = runCli(["--cwd", root, "--yaml", "--all"], { CODEX_THREAD_ID: "session-yaml" });

  try {
    assert.match(result.stdout, /summary:\n  running: 0\n  stopped: 1\n  closed: 0\n  total: 1\n  shown: 1/);
    assert.match(result.stdout, /runs:\n  -\n    agentId: "agent-1"/);
    assert.match(result.stdout, /    prompt: "inspect package\.json"/);
    assert.equal(result.stdout.includes("runKey:"), false);
    assert.equal(result.stdout.includes("startPayload:"), false);
    assert.match(result.stderr, /filter=all format=yaml/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional full YAML list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-full-yaml");
  const result = runCli(["--cwd", root, "--yaml", "--full", "--all"], { CODEX_THREAD_ID: "session-full-yaml" });

  try {
    assert.match(result.stdout, /sessionId: "session-full-yaml"/);
    assert.match(result.stdout, /runKey: "session-full-yaml:agent-1"/);
    assert.match(result.stdout, /startPayload:\n      hook_event_name: "SubagentStart"/);
    assert.match(result.stdout, /extra_field:\n        nested: true/);
    assert.match(result.stdout, /stopPayload:\n      hook_event_name: "SubagentStop"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filters stopped agents explicitly", async () => {
  const root = tempRoot();
  seedRun(root, "session-stopped", "running");
  seedRun(root, "session-stopped", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root, "--stopped"], { CODEX_THREAD_ID: "session-stopped" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.shown, 1);
    assert.equal(parsed.runs[0].agentId, "agent-stopped");
    assert.equal(parsed.runs[0].status, "stopped");
    assert.match(result.stderr, /filter=stopped/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filters closed agents and resets one closed mark", async () => {
  const root = tempRoot();
  seedRun(root, "session-closed", "stopped", "agent-closed");
  seedRun(root, "session-closed", "stopped", "agent-open");
  seedRun(root, "session-closed", "running", "agent-running-closed");
  closeRun(root, "session-closed", "agent-closed");
  closeRun(root, "session-closed", "agent-running-closed");

  const closed = runCli(["--cwd", root, "--closed"], { CODEX_THREAD_ID: "session-closed" });
  const running = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-closed" });
  const reset = runCli(["reset", "--cwd", root, "--agent", "agent-closed", "--text"], {
    CODEX_THREAD_ID: "session-closed"
  });
  const after = runCli(["--cwd", root, "--closed"], { CODEX_THREAD_ID: "session-closed" });

  try {
    const parsed = JSON.parse(closed.stdout);
    assert.equal(parsed.summary.running, 0);
    assert.equal(parsed.summary.closed, 2);
    assert.equal(parsed.summary.shown, 2);
    assert.deepEqual(
      parsed.runs.map((run: { agentId: string }) => run.agentId).sort(),
      ["agent-closed", "agent-running-closed"]
    );
    assert.equal(parsed.runs.every((run: { closed: boolean }) => run.closed), true);
    assert.deepEqual(JSON.parse(running.stdout).runs, []);
    assert.match(closed.stderr, /filter=closed/);
    assert.equal(reset.stdout, "reset closed session=session-closed agent=agent-closed matched=1 reset=1\n");
    assert.equal(JSON.parse(after.stdout).summary.shown, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv): { stdout: string; stderr: string } {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function closeRun(root: string, sessionId: string, agentId: string): void {
  const ledger = SubagentLedger.open(root);
  try {
    ledger.record({
      eventName: "PostToolUse",
      sessionId,
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: sessionId,
        cwd: root,
        tool_name: "close_agent",
        tool_use_id: "call-close",
        tool_input: {
          target: agentId
        },
        tool_response: {
          previous_status: "completed"
        }
      }
    });
  } finally {
    ledger.close();
  }
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "subagent-auto-manager-cli-"));
}

function seedRun(root: string, sessionId: string, status: "running" | "stopped" = "stopped", agentId = "agent-1"): void {
  const ledger = SubagentLedger.open(root);
  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId,
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: sessionId,
        turn_id: "turn-1",
        agent_id: agentId,
        agent_type: "explorer",
        model: "gpt-5.5",
        cwd: root,
        transcript_path: join(root, "parent.jsonl"),
        agent_transcript_path: join(root, "agent.jsonl"),
        permission_mode: "bypassPermissions",
        prompt: "inspect package.json",
        extra_field: {
          nested: true
        }
      }
    });
    if (status === "stopped") {
      ledger.record({
        eventName: "SubagentStop",
        sessionId,
        projectRoot: root,
        payload: {
          hook_event_name: "SubagentStop",
          session_id: sessionId,
          turn_id: "turn-1",
          agent_id: agentId,
          agent_type: "explorer",
          cwd: root,
          transcript_path: join(root, "parent.jsonl"),
          agent_transcript_path: join(root, "agent.jsonl"),
          last_assistant_message: "done"
        }
      });
    }
  } finally {
    ledger.close();
  }
}
