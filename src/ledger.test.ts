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
      closed: 0,
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

test("marks a subagent closed from successful close_agent PostToolUse and clears it on resume/reset", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);

  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "session-close",
        agent_id: "agent-close",
        agent_type: "explorer",
        cwd: root,
        prompt: "inspect package.json"
      }
    });

    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-close",
        cwd: root,
        tool_name: "close_agent",
        tool_use_id: "call-close",
        tool_input: {
          target: "agent-close"
        },
        tool_response: "{\"previous_status\":{\"completed\":\"done\"}}"
      }
    });

    assert.equal(ledger.summary("session-close").closed, 1);
    let [run] = ledger.listSession("session-close");
    assert.equal(run.closed, true);
    assert.notEqual(run.closeTime, null);
    assert.match(run.closePayload ?? "", /"tool_name":"close_agent"/);

    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-close",
        cwd: root,
        tool_name: "resume_agent",
        tool_use_id: "call-resume",
        tool_input: {
          id: "agent-close"
        },
        tool_response: "{\"status\":\"running\"}"
      }
    });

    [run] = ledger.listSession("session-close");
    assert.equal(run.closed, false);
    assert.equal(run.closeTime, null);

    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-close",
        cwd: root,
        tool_name: "multi_agent_v1__close_agent",
        tool_input: {
          target: "agent-close"
        },
        tool_response: {
          structuredContent: {
            previous_status: "running"
          },
          isError: false
        }
      }
    });

    [run] = ledger.listSession("session-close");
    assert.equal(run.closed, true);

    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-close",
        cwd: root,
        tool_name: "multi_agent_v1.resume_agent",
        tool_input: {
          id: "agent-close"
        },
        tool_response: {
          status: "running"
        }
      }
    });

    [run] = ledger.listSession("session-close");
    assert.equal(run.closed, false);

    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-close",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-close",
        cwd: root,
        tool_name: "multi_agent_v1.close_agent",
        tool_input: {
          target: "agent-close"
        },
        tool_response: {
          previous_status: "completed"
        }
      }
    });

    [run] = ledger.listSession("session-close");
    assert.equal(run.closed, true);

    assert.deepEqual(ledger.resetClosed("session-close", "agent-close"), {
      matched: 1,
      reset: 1
    });
    [run] = ledger.listSession("session-close");
    assert.equal(run.closed, false);
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores unrelated PostToolUse payloads when hooks match all tools", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);

  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId: "session-unrelated-tool",
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "session-unrelated-tool",
        agent_id: "agent-open",
        cwd: root
      }
    });

    const result = ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-unrelated-tool",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-unrelated-tool",
        cwd: root,
        tool_name: "shell_command",
        tool_input: {
          command: "npm test"
        },
        tool_response: {
          exit_code: 0
        }
      }
    });

    assert.deepEqual(result, {
      eventId: 0,
      subagentId: "",
      recorded: false
    });
    assert.equal(ledger.summary("session-unrelated-tool").closed, 0);
    assert.equal(ledger.listSession("session-unrelated-tool")[0]?.closed, false);
    assert.equal(
      ledger.eventsForSession("session-unrelated-tool").some((event) => event.event_name === "PostToolUse"),
      false
    );
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not mark close_agent with not_found previous status as closed", () => {
  const root = tempRoot();
  const ledger = SubagentLedger.open(root);

  try {
    ledger.record({
      eventName: "SubagentStart",
      sessionId: "session-not-found",
      projectRoot: root,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "session-not-found",
        agent_id: "agent-missing",
        cwd: root
      }
    });
    ledger.record({
      eventName: "PostToolUse",
      sessionId: "session-not-found",
      projectRoot: root,
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "session-not-found",
        cwd: root,
        tool_name: "close_agent",
        tool_input: {
          target: "agent-missing"
        },
        tool_response: {
          previous_status: "not_found"
        }
      }
    });

    assert.equal(ledger.summary("session-not-found").closed, 0);
    assert.equal(ledger.listSession("session-not-found")[0]?.closed, false);
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
