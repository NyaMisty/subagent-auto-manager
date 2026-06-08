# Codex Hook Payloads

## Supported Events

The hook entrypoint accepts:

- `SubagentStart`
- `SubagentStop`
- `PostToolUse`

The event name is read from `hook_event_name`.

`PostToolUse` is used only for subagent thread state tracking. A successful `close_agent` call marks the target agent as `closed`; a successful `resume_agent` call clears that mark.

The hook records the hook process parent PID in `hook_parent_pid` for diagnostics. It records `hook_session_pid` from `CODEX_PID` when that environment variable is set to a valid PID; otherwise it recursively walks the hook process `ppid` chain until it finds the nearest Codex process. When a later `SubagentStart` for the same `session_id` comes from a different identified Codex session process, older running runs for that session are treated as stale after a parent shutdown and automatically marked `stopped`. A direct hook parent PID change alone is ignored because shell, npm, and `npx` wrappers can be short-lived per hook invocation.

## Hook Configuration

Recommended command:

```sh
npx -y subagent-auto-manager@latest hook
```

Example `hooks.json`:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager@latest hook",
            "statusMessage": "Recording subagent start"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager@latest hook",
            "statusMessage": "Recording subagent stop"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "(close_agent|resume_agent)$",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager@latest hook",
            "statusMessage": "Recording subagent close/resume"
          }
        ]
      }
    ]
  }
}
```

## Example Inputs

`SubagentStart`:

```json
{
  "hook_event_name": "SubagentStart",
  "session_id": "019e87b0-d695-7902-96e1-9672e0a12db6",
  "turn_id": "turn-1",
  "agent_id": "agent-1",
  "agent_type": "general",
  "cwd": "D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager",
  "model": "gpt-5",
  "model_reasoning_effort": "high",
  "sandbox_mode": "workspace-write",
  "approval_policy": "on-request",
  "fork_context": false,
  "permission_mode": "default",
  "transcript_path": "D:\\project\\parent.jsonl",
  "agent_transcript_path": "D:\\project\\subagents\\agent-1.jsonl",
  "prompt": "Inspect package.json"
}
```

`SubagentStop`:

```json
{
  "hook_event_name": "SubagentStop",
  "session_id": "019e87b0-d695-7902-96e1-9672e0a12db6",
  "turn_id": "turn-1",
  "agent_id": "agent-1",
  "agent_type": "general",
  "cwd": "D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager",
  "transcript_path": "D:\\project\\parent.jsonl",
  "agent_transcript_path": "D:\\project\\subagents\\agent-1.jsonl",
  "stop_hook_active": false,
  "last_assistant_message": "Package name: subagent-auto-manager"
}
```

`PostToolUse` close:

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "019e87b0-d695-7902-96e1-9672e0a12db6",
  "cwd": "D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager",
  "tool_name": "close_agent",
  "tool_use_id": "call-close",
  "tool_input": {
    "target": "agent-1"
  },
  "tool_response": {
    "previous_status": {
      "completed": "done"
    }
  }
}
```

`PostToolUse` resume:

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "019e87b0-d695-7902-96e1-9672e0a12db6",
  "cwd": "D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager",
  "tool_name": "resume_agent",
  "tool_use_id": "call-resume",
  "tool_input": {
    "id": "agent-1"
  },
  "tool_response": {
    "status": "running"
  }
}
```

## Recorded Fields

Known fields are copied to queryable columns:

- `session_id`
- `hook_parent_pid`
- `hook_session_pid`
- `turn_id`
- `agent_id`
- `agent_type`
- `permission_mode`
- `model`
- `cwd`
- `transcript_path`
- `agent_transcript_path`
- `prompt`
- `last_assistant_message`
- `start_args_json`
- `stop_hook_active`
- `tool_name`
- `tool_use_id`
- `close_target`

`start_args_json` is derived from `SubagentStart`. It stores a compact JSON snapshot of launch parameters such as agent type, model, `model_reasoning_effort`, sandbox or approval settings, fork flags, prompt, and any custom fields, while excluding lifecycle metadata such as `hook_event_name`, `session_id`, `turn_id`, `transcript_path`, and `agent_transcript_path`.

Every stored payload is also stored as compact raw JSON in `payload_json`, so new Codex fields are retained without a schema change. The hook ignores unrelated `PostToolUse` payloads; only recognized `close_agent` and `resume_agent` calls are stored from that event.

## Closed State

`SubagentStop` means the subagent turn ended. It does not prove that the parent closed the agent thread.

List output exposes `stopReason` for stopped and closed rows when available. `hook` means a real `SubagentStop` hook row was recorded. `pid-change` means a running row was marked stopped because a later `SubagentStart` for the same session came from a different identified Codex session process.

Rows stopped with `pid-change` are stale markers, not raw `SubagentStop` records. They have `stop_time` and `stopReason: "pid-change"`, but no `stop_event_id` or `stop_payload`.

For human diagnostics of PID detection, run:

```sh
npx -y subagent-auto-manager@latest debug --human --text
```

The report includes `CODEX_PID`, current `pid`/`ppid`, recursive process lineage, Codex process matches, resolved `hook_session_pid`, session summary, recent ledger rows, and grouped ledger `hook_parent_pid` / `hook_session_pid` values.

Closed state is inferred from `PostToolUse`. Configure `PostToolUse` with `(close_agent|resume_agent)$` so Codex forwards bare names and namespaced tool-name variants.

- `close_agent` with `tool_input.target` and a successful response marks that target `closed`.
- `resume_agent` with `tool_input.id` and a successful response clears `closed`.
- `close_agent` responses whose `previous_status` is `not_found` are ignored because they do not prove an open tracked agent was closed.

## Wait-All Helper

`SubagentStop` rows also support a wait-all CLI helper:

```sh
npx -y subagent-auto-manager@latest wait --agent agent-a --agent agent-b --timeout-ms 600000
```

The helper polls the project ledger and returns only when every requested target is `stopped`. Unlike Codex's built-in multi-target wait tool, which returns when one target completes, this helper treats started-but-not-returned and missing targets as incomplete and exits non-zero when the timeout expires. Timeout output identifies the targets that did not stop: JSON/YAML output includes them in `incompleteTargets`, text output prints `Pending` for targets that started but have not returned yet and `Miss` for targets with no matching ledger row, and stderr receives one `[subagent-auto-manager] wait timeout ...` line for each incomplete target.
