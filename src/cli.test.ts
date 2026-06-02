import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SubagentLedger } from "./ledger.js";

test("defaults list output to medium JSON", async () => {
  const root = tempRoot();
  seedRun(root, "session-json");
  const output = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-json" });

  try {
    const parsed = JSON.parse(output);
    assert.deepEqual(parsed.summary, {
      sessionId: "session-json",
      running: 0,
      stopped: 1,
      total: 1
    });
    assert.deepEqual(Object.keys(parsed.runs[0]), [
      "runKey",
      "subagentId",
      "agentId",
      "agentType",
      "sessionId",
      "turnId",
      "status",
      "startTime",
      "stopTime",
      "durationMs",
      "prompt",
      "lastAssistantMessage",
      "model",
      "cwd"
    ]);
    assert.equal(parsed.runs[0].prompt, "inspect package.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports full JSON list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-full");
  const output = runCli(["--cwd", root, "--full"], { CODEX_THREAD_ID: "session-full" });

  try {
    const parsed = JSON.parse(output);
    assert.equal(parsed.runs[0].transcriptPath, join(root, "parent.jsonl"));
    assert.deepEqual(parsed.runs[0].startPayload.extra_field, { nested: true });
    assert.equal(parsed.runs[0].stopPayload.last_assistant_message, "done");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("defaults empty list output to JSON", async () => {
  const root = tempRoot();
  const output = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-empty" });

  try {
    assert.deepEqual(JSON.parse(output), {
      summary: {
        sessionId: "session-empty",
        running: 0,
        stopped: 0,
        total: 0
      },
      runs: []
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional text list output", async () => {
  const root = tempRoot();
  const output = runCli(["--cwd", root, "--text"], { CODEX_THREAD_ID: "session-text" });

  try {
    assert.equal(output, "session session-text total=0 running=0 stopped=0\nno subagents\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional YAML list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-yaml");
  const output = runCli(["--cwd", root, "--yaml"], { CODEX_THREAD_ID: "session-yaml" });

  try {
    assert.match(output, /summary:\n  sessionId: "session-yaml"\n  running: 0\n  stopped: 1\n  total: 1/);
    assert.match(output, /runs:\n  -\n    runKey: "session-yaml:agent-1"/);
    assert.match(output, /    prompt: "inspect package\.json"/);
    assert.equal(output.includes("startPayload:"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional full YAML list output", async () => {
  const root = tempRoot();
  seedRun(root, "session-full-yaml");
  const output = runCli(["--cwd", root, "--yaml", "--full"], { CODEX_THREAD_ID: "session-full-yaml" });

  try {
    assert.match(output, /startPayload:\n      hook_event_name: "SubagentStart"/);
    assert.match(output, /extra_field:\n        nested: true/);
    assert.match(output, /stopPayload:\n      hook_event_name: "SubagentStop"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
  return execFileSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "subagent-auto-manager-cli-"));
}

function seedRun(root: string, sessionId: string): void {
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
        agent_id: "agent-1",
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
    ledger.record({
      eventName: "SubagentStop",
      sessionId,
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStop",
        session_id: sessionId,
        turn_id: "turn-1",
        agent_id: "agent-1",
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
