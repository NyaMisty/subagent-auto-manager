import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

test("defaults output to summary JSON without runs property", async () => {
  const root = tempRoot();
  seedRun(root, "session-json", "running");
  seedRun(root, "session-json", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-json" });

  try {
    assert.match(result.stdout, /^\{\n  "summary":/);
    assert.match(result.stderr, /filter=running format=json detail=summary session=session-json shown=1\/2/);
    assert.match(result.stderr, /--status stopped/);
    assert.equal(result.stderr.includes("--all"), false);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.summary, {
      running: 1,
      stopped: 1,
      closed: 0,
      total: 2,
      shown: 1
    });
    assert.equal("runs" in parsed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filter output defaults to compact agent id and state", async () => {
  const root = tempRoot();
  seedRun(root, "session-compact", "running");
  seedRun(root, "session-compact", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root, "--all", "--human"], { CODEX_THREAD_ID: "session-compact" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.shown, 2);
    assert.deepEqual(
      parsed.runs.map((run: Record<string, unknown>) => Object.keys(run)),
      [
        ["agentId", "state"],
        ["agentId", "state", "stopReason"]
      ]
    );
    assert.deepEqual(
      parsed.runs.map((run: { agentId: string; state: string; stopReason?: string }) => [run.agentId, run.state, run.stopReason ?? null]).sort(),
      [
        ["agent-1", "running", null],
        ["agent-stopped", "stopped", "hook"]
      ]
    );
    assert.match(result.stderr, /filter=all format=json detail=compact session=session-compact shown=2\/2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports explicit medium JSON list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-json-medium", "running");
  seedRun(root, "session-json-medium", "stopped", "agent-stopped");
  const result = runCli(["--cwd", root, "--medium"], { CODEX_THREAD_ID: "session-json-medium" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed.runs[0]), [
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
  const result = runCli(["--cwd", root, "--all", "--full", "--human"], { CODEX_THREAD_ID: "session-full" });

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
      }
    });
    assert.match(result.stderr, /filter=running format=json detail=summary/);
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
  const result = runCli(["--cwd", root, "--yaml", "--all", "--medium", "--human"], { CODEX_THREAD_ID: "session-yaml" });

  try {
    assert.match(result.stdout, /summary:\n  running: 0\n  stopped: 1\n  closed: 0\n  total: 1\n  shown: 1/);
    assert.match(result.stdout, /runs:\n  -\n    agentId: "agent-1"/);
    assert.match(result.stdout, /    state: "stopped"/);
    assert.match(result.stdout, /    prompt: "inspect package\.json"/);
    assert.match(result.stdout, /    startArgs:\n      agent_id: "agent-1"/);
    assert.match(result.stdout, /      model_reasoning_effort: "high"/);
    assert.equal(result.stdout.includes("runKey:"), false);
    assert.equal(result.stdout.includes("startPayload:"), false);
    assert.match(result.stderr, /filter=all format=yaml detail=medium/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional full YAML list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-full-yaml");
  const result = runCli(["--cwd", root, "--yaml", "--full", "--all", "--human"], { CODEX_THREAD_ID: "session-full-yaml" });

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
    assert.equal(parsed.runs[0].stopReason, "hook");
    assert.deepEqual(Object.keys(parsed.runs[0]), ["agentId", "state", "stopReason"]);
    assert.match(result.stderr, /filter=stopped format=json detail=compact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filters list output by agent id", async () => {
  const root = tempRoot();
  seedRun(root, "session-agent-filter", "running", "agent-target");
  seedRun(root, "session-agent-filter", "running", "agent-other");
  seedRun(root, "session-agent-filter", "stopped", "agent-done");
  const byAgent = runCli(["--cwd", root, "--agent", "agent-target"], { CODEX_THREAD_ID: "session-agent-filter" });
  const byRunKey = runCli(["--cwd", root, "--agent", "session-agent-filter:agent-done", "--status", "all", "--human"], {
    CODEX_THREAD_ID: "session-agent-filter"
  });

  try {
    const parsed = JSON.parse(byAgent.stdout);
    assert.equal(parsed.summary.running, 2);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.summary.total, 3);
    assert.equal(parsed.summary.shown, 1);
    assert.deepEqual(parsed.runs, [
      {
        agentId: "agent-target",
        state: "running"
      }
    ]);
    assert.match(byAgent.stderr, /filter=running format=json detail=compact session=session-agent-filter agent=agent-target shown=1\/3/);

    const runKeyParsed = JSON.parse(byRunKey.stdout);
    assert.equal(runKeyParsed.summary.shown, 1);
    assert.deepEqual(runKeyParsed.runs, [
      {
        agentId: "agent-done",
        state: "stopped",
        stopReason: "hook"
      }
    ]);
    assert.match(byRunKey.stderr, /agent=session-agent-filter:agent-done shown=1\/3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI running output excludes stale runs auto-stopped after hook parent pid changes", async () => {
  const root = tempRoot();
  seedRun(root, "session-parent-pid", "running", "agent-stale", 100);
  seedRun(root, "session-parent-pid", "running", "agent-current", 200);
  const result = runCli(["--cwd", root, "--running"], { CODEX_THREAD_ID: "session-parent-pid" });

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.running, 1);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.summary.total, 2);
    assert.deepEqual(parsed.runs, [
      {
        agentId: "agent-current",
        state: "running"
      }
    ]);
    const stopped = runCli(["--cwd", root, "--stopped"], { CODEX_THREAD_ID: "session-parent-pid" });
    assert.deepEqual(JSON.parse(stopped.stdout).runs, [
      {
        agentId: "agent-stale",
        state: "stopped",
        stopReason: "pid-change"
      }
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filters closed agents, closes stopped runs by reset, and clears one closed mark with human override", async () => {
  const root = tempRoot();
  seedRun(root, "session-closed", "stopped", "agent-closed");
  seedRun(root, "session-closed", "stopped", "agent-open");
  seedRun(root, "session-closed", "running", "agent-running-closed");
  closeRun(root, "session-closed", "agent-closed");
  closeRun(root, "session-closed", "agent-running-closed");

  const closed = runCli(["--cwd", root, "--closed", "--human"], { CODEX_THREAD_ID: "session-closed" });
  const running = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-closed" });
  const resetStopped = runCli(["reset", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-closed"
  });
  const resetNeedsHuman = runCli(["reset", "--cwd", root, "--agent", "agent-closed", "--text"], {
    CODEX_THREAD_ID: "session-closed"
  }, 1);
  const resetOne = runCli(["reset", "--cwd", root, "--agent", "agent-closed", "--human", "--text"], {
    CODEX_THREAD_ID: "session-closed"
  });
  const after = runCli(["--cwd", root, "--closed", "--human"], { CODEX_THREAD_ID: "session-closed" });

  try {
    const parsed = JSON.parse(closed.stdout);
    assert.equal(parsed.summary.running, 0);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.summary.closed, 2);
    assert.equal(parsed.summary.shown, 2);
    assert.deepEqual(
      parsed.runs.map((run: { agentId: string; stopReason?: string }) => [run.agentId, run.stopReason ?? null]).sort(),
      [
        ["agent-closed", "hook"],
        ["agent-running-closed", null]
      ]
    );
    assert.equal(parsed.runs.every((run: { state: string }) => run.state === "closed"), true);
    assert.equal(parsed.runs.some((run: Record<string, unknown>) => "closed" in run), false);
    assert.equal(parsed.runs.some((run: Record<string, unknown>) => "status" in run), false);
    assert.equal("runs" in JSON.parse(running.stdout), false);
    assert.match(closed.stderr, /filter=closed/);
    assert.equal(resetStopped.stdout, "reset stopped session=session-closed matched=1 closed=1\n");
    assert.equal(resetNeedsHuman.stdout, "");
    assert.match(resetNeedsHuman.stderr, /reset --agent requires --human/);
    assert.equal(resetOne.stdout, "reset closed session=session-closed agent=agent-closed matched=1 reset=1\n");
    const afterParsed = JSON.parse(after.stdout);
    assert.equal(afterParsed.summary.closed, 2);
    assert.equal(afterParsed.summary.stopped, 1);
    assert.equal(afterParsed.summary.shown, 2);
    assert.deepEqual(
      afterParsed.runs.map((run: { agentId: string }) => run.agentId).sort(),
      ["agent-open", "agent-running-closed"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset --full closes running and stopped runs", async () => {
  const root = tempRoot();
  seedRun(root, "session-reset-full", "running", "agent-running");
  seedRun(root, "session-reset-full", "stopped", "agent-stopped");
  seedRun(root, "session-reset-full", "stopped", "agent-already-closed");
  closeRun(root, "session-reset-full", "agent-already-closed");

  const needsHuman = runCli(["reset", "--full", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-reset-full"
  }, 1);
  const result = runCli(["reset", "--full", "--human", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-reset-full"
  });
  const running = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-reset-full" });
  const closed = runCli(["--cwd", root, "--closed", "--human"], { CODEX_THREAD_ID: "session-reset-full" });

  try {
    assert.match(needsHuman.stderr, /reset --full requires --human/);
    assert.equal(result.stdout, "reset full session=session-reset-full matched=2 closed=2\n");
    assert.equal("runs" in JSON.parse(running.stdout), false);
    const parsed = JSON.parse(closed.stdout);
    assert.equal(parsed.summary.running, 0);
    assert.equal(parsed.summary.stopped, 0);
    assert.equal(parsed.summary.closed, 3);
    assert.equal(parsed.summary.total, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset full mode only accepts reset --full order", async () => {
  const root = tempRoot();
  seedRun(root, "session-reset-full-order", "running", "agent-running");

  const before = runCli(["--full", "reset", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-reset-full-order"
  }, 1);
  const all = runCli(["reset", "--all", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-reset-full-order"
  }, 1);
  const detail = runCli(["reset", "--detail", "full", "--cwd", root, "--text"], {
    CODEX_THREAD_ID: "session-reset-full-order"
  }, 1);

  try {
    assert.match(before.stderr, /reset --full must be passed after reset/);
    assert.match(all.stderr, /reset full mode must use reset --full/);
    assert.match(detail.stderr, /reset full mode must use reset --full/);
    assert.equal(JSON.parse(runCli(["--cwd", root], { CODEX_THREAD_ID: "session-reset-full-order" }).stdout).summary.running, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires human override for broad and closed list queries", async () => {
  const root = tempRoot();
  seedRun(root, "session-human", "running");
  seedRun(root, "session-human", "stopped", "agent-stopped");
  closeRun(root, "session-human", "agent-stopped");

  try {
    for (const args of [
      ["--cwd", root, "--status", "all"],
      ["--cwd", root, "--status=all"],
      ["--cwd", root, "--all"],
      ["list", "--cwd", root],
      ["--cwd", root, "--status", "closed"],
      ["--cwd", root, "--status=closed"],
      ["--cwd", root, "--closed"],
      ["--cwd", root, "--after-timestamp", "0"]
    ]) {
      const result = runCli(args, { CODEX_THREAD_ID: "session-human" }, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /--status (all|closed) requires --human/);
    }

    const all = runCli(["--cwd", root, "--status", "all", "--human"], { CODEX_THREAD_ID: "session-human" });
    const closed = runCli(["--human", "--cwd", root, "--status=closed"], { CODEX_THREAD_ID: "session-human" });
    assert.equal(JSON.parse(all.stdout).summary.shown, 2);
    assert.equal(JSON.parse(closed.stdout).summary.shown, 1);
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

  const result = runCli(["--cwd", root, "--after-timestamp", String(threshold), "--human"], {
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
    assert.equal(parsed.runs.some((run: { agentId: string; state: string }) => run.agentId === "agent-closed-after" && run.state === "closed"), true);
    assert.equal(parsed.runs.some((run: { agentId: string; state: string }) => run.agentId === "agent-stopped-after" && run.state === "stopped"), true);
    assert.equal(
      parsed.runs.every((run: Record<string, unknown>) =>
        run.agentId === "agent-stopped-after" ? Object.keys(run).join(",") === "agentId,state,stopReason" : Object.keys(run).join(",") === "agentId,state"
      ),
      true
    );
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
    assert.deepEqual(parsed.incompleteTargets, []);
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

test("wait streams each newly stopped agent id to stderr", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-stream", "running", "agent-stream");
  let child: ReturnType<typeof spawn> | null = null;

  try {
    const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
    child = spawn(
      process.execPath,
      [cliPath, "wait", "agent-stream", "--cwd", root, "--timeout-ms", "5000", "--interval-ms", "50"],
      {
        env: { ...process.env, CODEX_THREAD_ID: "session-wait-stream" },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const exit = waitForExit(child);

    let stdout = "";
    let stderr = "";
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    await delay(150);
    stopRun(root, "session-wait-stream", "agent-stream");
    await waitForText(() => stderr, "wait stopped agentId=agent-stream");
    const exitCode = await exit;

    assert.equal(exitCode, 0, stderr);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.summary.complete, true);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.targets[0].state, "stopped");
    assert.match(stderr, /\[subagent-auto-manager\] wait stopped agentId=agent-stream type=explorer/);
    assert.doesNotMatch(stderr, /target=/);
  } finally {
    if (child && child.exitCode === null && !child.killed) {
      child.kill();
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("wait times out for running or missing targets", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-timeout", "running", "agent-running");
  seedRun(root, "session-wait-timeout", "stopped", "agent-done");
  const result = runCli(
    ["wait", "agent-running", "agent-done", "agent-missing", "--cwd", root, "--timeout-ms", "0", "--text"],
    { CODEX_THREAD_ID: "session-wait-timeout" },
    1
  );

  try {
    assert.match(result.stdout, /^wait timeout session=session-wait-timeout targets=3 stopped=1 running=1 missing=1 /);
    assert.match(result.stdout, /Pending agent-running explorer/);
    assert.match(result.stdout, /Miss agent-missing/);
    assert.equal(result.stdout.includes("Stopped agent-done"), false);
    assert.match(result.stderr, /\[subagent-auto-manager\] wait stopped agentId=agent-done type=explorer/);
    assert.match(result.stderr, /\[subagent-auto-manager\] wait timeout agentId=agent-running state=running type=explorer/);
    assert.match(result.stderr, /\[subagent-auto-manager\] wait timeout target=agent-missing state=missing/);
    assert.doesNotMatch(result.stderr, /wait timeout agentId=agent-done/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wait timeout JSON exposes incomplete targets and exits non-zero", async () => {
  const root = tempRoot();
  seedRun(root, "session-wait-timeout-json", "running", "agent-running");
  seedRun(root, "session-wait-timeout-json", "stopped", "agent-done");
  const result = runCli(
    ["wait", "agent-running", "agent-done", "agent-missing", "--cwd", root, "--timeout-ms", "0"],
    { CODEX_THREAD_ID: "session-wait-timeout-json" },
    1
  );

  try {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.complete, false);
    assert.equal(parsed.summary.stopped, 1);
    assert.equal(parsed.summary.running, 1);
    assert.equal(parsed.summary.missing, 1);
    assert.deepEqual(
      parsed.incompleteTargets.map((target: { target: string; state: string }) => [target.target, target.state]),
      [
        ["agent-running", "running"],
        ["agent-missing", "missing"]
      ]
    );
    assert.deepEqual(
      parsed.targets.map((target: { target: string; state: string }) => [target.target, target.state]),
      [
        ["agent-running", "running"],
        ["agent-done", "stopped"],
        ["agent-missing", "missing"]
      ]
    );
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

function stopRun(root: string, sessionId: string, agentId: string): void {
  const ledger = SubagentLedger.open(root);
  try {
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
  } finally {
    ledger.close();
  }
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "subagent-auto-manager-cli-"));
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function waitForText(read: () => string, text: string, timeoutMs = 2000): Promise<void> {
  const startMs = Date.now();
  while (!read().includes(text)) {
    if (Date.now() - startMs >= timeoutMs) {
      throw new Error(`timed out waiting for text: ${text}`);
    }
    await delay(20);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function seedRun(
  root: string,
  sessionId: string,
  status: "running" | "stopped" = "stopped",
  agentId = "agent-1",
  hookParentPid?: number
): void {
  const ledger = SubagentLedger.open(root);
  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId,
      projectRoot: root,
      hookParentPid,
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
        hookParentPid,
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
