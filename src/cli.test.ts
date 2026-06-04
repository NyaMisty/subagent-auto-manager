import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SubagentLedger } from "./ledger.js";
import { databasePath } from "./paths.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

test("defaults output to pretty medium JSON filtered to running agents", async () => {
  const root = tempRoot();
  seedRun(root, "session-json", "running");
  seedRun(root, "session-json", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-json" });

  try {
    assert.match(result.stdout, /^\{\n  "summary":/);
    assert.match(result.stderr, /filter=running format=json detail=medium session=session-json shown=1\/2/);
    assert.match(result.stderr, /--state all/);
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
      "state",
      "prompt",
      "startTime",
      "stopTime",
      "closeTime",
      "durationMs",
      "lastAssistantMessage",
      "startArgs",
      "model",
      "cwd"
    ]);
    assert.equal(parsed.runs[0].agentId, "agent-1");
    assert.equal(parsed.runs[0].state, "running");
    assert.equal(parsed.runs[0].prompt, "inspect package.json");
    assert.deepEqual(parsed.runs[0].startArgs, {
      agent_id: "agent-1",
      agent_type: "explorer",
      cwd: root,
      extra_field: {
        nested: true
      },
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      permission_mode: "bypassPermissions",
      prompt: "inspect package.json"
    });
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
    assert.equal(parsed.runs[0].state, "stopped");
    assert.equal("status" in parsed.runs[0], false);
    assert.equal("closed" in parsed.runs[0], false);
    assert.equal(parsed.runs[0].runKey, "session-full:agent-1");
    assert.equal(parsed.runs[0].sessionId, "session-full");
    assert.equal(parsed.runs[0].transcriptPath, join(root, "parent.jsonl"));
    assert.equal(parsed.runs[0].startArgs.model_reasoning_effort, "high");
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
    assert.match(result.stdout, /    state: "stopped"/);
    assert.match(result.stdout, /    prompt: "inspect package\.json"/);
    assert.match(result.stdout, /    startArgs:\n      agent_id: "agent-1"/);
    assert.match(result.stdout, /      model_reasoning_effort: "high"/);
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
    assert.equal(parsed.runs[0].state, "stopped");
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
  const stateClosed = runCli(["--cwd", root, "--state", "closed"], { CODEX_THREAD_ID: "session-closed" });
  const running = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-closed" });
  const reset = runCli(["reset", "--cwd", root, "--agent", "agent-closed", "--text"], {
    CODEX_THREAD_ID: "session-closed"
  });
  const after = runCli(["--cwd", root, "--closed"], { CODEX_THREAD_ID: "session-closed" });

  try {
    const parsed = JSON.parse(closed.stdout);
    assert.deepEqual(JSON.parse(stateClosed.stdout).runs, parsed.runs);
    assert.equal(parsed.summary.running, 0);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.summary.closed, 2);
    assert.equal(parsed.summary.shown, 2);
    assert.deepEqual(
      parsed.runs.map((run: { agentId: string }) => run.agentId).sort(),
      ["agent-closed", "agent-running-closed"]
    );
    assert.equal(parsed.runs.every((run: { state: string }) => run.state === "closed"), true);
    assert.equal(parsed.runs.some((run: Record<string, unknown>) => "closed" in run), false);
    assert.equal(parsed.runs.some((run: Record<string, unknown>) => "status" in run), false);
    assert.deepEqual(JSON.parse(running.stdout).runs, []);
    assert.match(closed.stderr, /filter=closed/);
    assert.equal(reset.stdout, "reset closed session=session-closed agent=agent-closed matched=1 reset=1\n");
    assert.equal(JSON.parse(after.stdout).summary.shown, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("after-timestamp lists all agent statuses started after the Unix timestamp", async () => {
  const root = tempRoot();
  const sessionId = "session-after";
  const threshold = Math.floor(Date.parse("2026-06-04T00:00:30.000Z") / 1000);
  seedRun(root, sessionId, "stopped", "agent-old");
  seedRun(root, sessionId, "running", "agent-running-after");
  seedRun(root, sessionId, "stopped", "agent-stopped-after");
  seedRun(root, sessionId, "running", "agent-closed-after");
  closeRun(root, sessionId, "agent-closed-after");
  setRunStartTime(root, `${sessionId}:agent-old`, "2026-06-04T00:00:00.000Z");
  setRunStartTime(root, `${sessionId}:agent-running-after`, "2026-06-04T00:01:00.000Z");
  setRunStartTime(root, `${sessionId}:agent-stopped-after`, "2026-06-04T00:02:00.000Z");
  setRunStartTime(root, `${sessionId}:agent-closed-after`, "2026-06-04T00:03:00.000Z");

  const result = runCli(["--cwd", root, "--after-timestamp", String(threshold)], {
    CODEX_THREAD_ID: sessionId
  });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.total, 4);
    assert.equal(parsed.summary.shown, 3);
    assert.deepEqual(
      parsed.runs.map((run: { agentId: string }) => run.agentId).sort(),
      ["agent-closed-after", "agent-running-after", "agent-stopped-after"]
    );
    assert.equal(parsed.runs.some((run: { agentId: string; closed: boolean }) => run.agentId === "agent-closed-after" && run.closed), true);
    assert.equal(parsed.runs.some((run: { agentId: string; status: string }) => run.agentId === "agent-stopped-after" && run.status === "stopped"), true);
    assert.match(result.stderr, /filter=all/);
    assert.match(result.stderr, new RegExp(`after_timestamp=${threshold}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects invalid after-timestamp values", async () => {
  const root = tempRoot();
  const result = runCli(["--cwd", root, "--after-timestamp", "12.5"], { CODEX_THREAD_ID: "session-after-invalid" }, 1);

  try {
    assert.match(result.stderr, /--after-timestamp requires a non-negative Unix timestamp in seconds/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wait returns when every target is stopped", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-done", "stopped", "agent-a");
  seedRun(root, "session-wait-done", "stopped", "agent-b");
  const result = runCli(["wait", "agent-a", "--agent", "agent-b", "--cwd", root, "--timeout-ms", "0"], {
    CODEX_THREAD_ID: "session-wait-done"
  });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.complete, true);
    assert.equal(parsed.summary.stopped, 2);
    assert.equal(parsed.summary.running, 0);
    assert.equal(parsed.summary.missing, 0);
    assert.deepEqual(
      parsed.targets.map((target: { target: string; state: string }) => [target.target, target.state]),
      [
        ["agent-a", "stopped"],
        ["agent-b", "stopped"]
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wait times out for running or missing targets", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-timeout", "running", "agent-running");
  seedRun(root, "session-wait-timeout", "stopped", "agent-done");
  const result = runCli(
    ["wait", "agent-running", "agent-missing", "--cwd", root, "--timeout-ms", "0", "--text"],
    { CODEX_THREAD_ID: "session-wait-timeout" },
    1
  );

  try {
    assert.match(result.stdout, /^wait timeout session=session- targets=2 stopped=0 running=1 missing=1 /);
    assert.match(result.stdout, /RUN agent-ru explorer/);
    assert.match(result.stdout, /MISS agent-mi/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wait snapshots current running agents when no targets are provided", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-snapshot", "running", "agent-open");
  seedRun(root, "session-wait-snapshot", "stopped", "agent-done");
  closeRun(root, "session-wait-snapshot", "agent-open");
  const result = runCli(["wait", "--cwd", root, "--timeout-ms", "0"], { CODEX_THREAD_ID: "session-wait-snapshot" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.complete, true);
    assert.equal(parsed.summary.total, 0);
    assert.deepEqual(parsed.targets, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv, expectedStatus = 0): { stdout: string; stderr: string } {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  assert.equal(result.status, expectedStatus, result.stderr);
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

function setRunStartTime(root: string, runKey: string, startTime: string): void {
  const db = new DatabaseSync(databasePath(root));
  try {
    db.prepare("UPDATE subagent_runs SET start_time = ?, updated_at = ? WHERE run_key = ?").run(
      startTime,
      startTime,
      runKey
    );
  } finally {
    db.close();
  }
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
        model_reasoning_effort: "high",
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
