import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SubagentLedger } from "./ledger.js";
import { databasePath } from "./paths.js";

test("records start and stop events with full payload JSON", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);

  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId: "session-a",
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "session-a",
        turn_id: "turn-1",
        agent_id: "agent-1",
        agent_type: "general",
        model: "gpt-5",
        cwd: root,
        transcript_path: join(root, "transcript.jsonl"),
        agent_transcript_path: join(root, "subagents", "agent-1.jsonl"),
        permission_mode: "default",
        prompt: "inspect the codebase",
        extra_field: { nested: true }
      }
    });

    ledger.record({
      eventName: "SubagentStop",
      sessionId: "session-a",
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStop",
        session_id: "session-a",
        turn_id: "turn-1",
        agent_id: "agent-1",
        agent_type: "general",
        cwd: root,
        transcript_path: join(root, "transcript.jsonl"),
        agent_transcript_path: join(root, "subagents", "agent-1.jsonl"),
        stop_hook_active: false,
        last_assistant_message: "done",
        result: "ok"
      }
    });

    const summary = ledger.summary("session-a");
    assert.deepEqual(summary, {
      sessionId: "session-a",
      running: 0,
      stopped: 1,
      total: 1
    });

    const [run] = ledger.listSession("session-a");
    assert.equal(run.agentId, "agent-1");
    assert.equal(run.agentType, "general");
    assert.equal(run.model, "gpt-5");
    assert.equal(run.agentTranscriptPath, join(root, "subagents", "agent-1.jsonl"));
    assert.equal(run.status, "stopped");
    assert.equal(run.prompt, "inspect the codebase");
    assert.equal(run.lastAssistantMessage, "done");
    assert.match(run.startPayload, /"extra_field":\{"nested":true\}/);
    assert.match(run.stopPayload ?? "", /"result":"ok"/);

    const events = ledger.eventsForSession("session-a");
    assert.equal(events.length, 2);
    assert.equal(events[0]?.event_name, "SubagentStart");
    assert.equal(events[1]?.event_name, "SubagentStop");
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps sessions isolated in the same project database", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);

  try {
    for (const sessionId of ["session-a", "session-b"]) {
      ledger.record({
        eventName: "SubagentStart",
        sessionId,
        projectRoot: root,
        payload: {
          hook_event_name: "SubagentStart",
          session_id: sessionId,
          agent_id: "same-agent",
          prompt: sessionId,
          cwd: root
        }
      });
    }

    assert.equal(ledger.summary("session-a").running, 1);
    assert.equal(ledger.summary("session-b").running, 1);
    assert.equal(ledger.listSession("session-a")[0]?.prompt, "session-a");
    assert.equal(ledger.listSession("session-b")[0]?.prompt, "session-b");
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stores database below .codex/subagent_auto_manager.db", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);
  ledger.close();

  try {
    assert.equal(databasePath(root), join(root, ".codex", "subagent_auto_manager.db", "ledger.sqlite3"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "subagent-auto-manager-"));
}
