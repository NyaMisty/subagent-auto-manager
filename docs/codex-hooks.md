# Codex Hook Payloads

## Supported Events

The hook entrypoint accepts:

- `SubagentStart`
- `SubagentStop`
- `PostToolUse`
- `Stop`

The event name is read from `hook_event_name`.

`PostToolUse` is used only for subagent thread state tracking. A successful `close_agent` call marks the target agent as `closed`; a successful `resume_agent` call clears that mark. `Stop` is also used as a transcript replay fallback for Codex builds that do not emit `PostToolUse` for multi-agent tools.

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
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager@latest hook",
            "statusMessage": "Replaying subagent close/resume"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "(^|.*(__|\\.))(close_agent|resume_agent)$",
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
- `stop_hook_active`
- `tool_name`
- `tool_use_id`
- `close_target`

Every stored payload is also stored as compact raw JSON in `payload_json`, so new Codex fields are retained without a schema change. The hook ignores unrelated `PostToolUse` payloads; only recognized `close_agent` and `resume_agent` calls are stored from that event.

## Closed State

`SubagentStop` means the subagent turn ended. It does not prove that the parent closed the agent thread.

Closed state is inferred from `PostToolUse`, plus `Stop` transcript replay as a fallback. Configure `PostToolUse` with a suffix matcher such as `(^|.*(__|\\.))(close_agent|resume_agent)$` so Codex forwards bare and namespaced tool-name variants when available. Keep the `Stop` hook configured because some Codex builds record multi-agent tool calls in the transcript without firing `PostToolUse` for them.

- `close_agent` with `tool_input.target` and a successful response marks that target `closed`.
- `resume_agent` with `tool_input.id` and a successful response clears `closed`.
- `close_agent` responses whose `previous_status` is `not_found` are ignored because they do not prove an open tracked agent was closed.

## Wait-All Helper

`SubagentStop` rows also support a wait-all CLI helper:

```sh
npx -y subagent-auto-manager@latest wait --agent agent-a --agent agent-b --timeout-ms 600000
```

The helper polls the project ledger and returns only when every requested target is `stopped`. Unlike Codex's built-in multi-target wait tool, which returns when one target completes, this helper treats running and missing targets as incomplete and exits non-zero when the timeout expires.
