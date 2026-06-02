# Codex Hook Payloads

## Supported Events

The hook entrypoint accepts:

- `SubagentStart`
- `SubagentStop`

The event name is read from `hook_event_name`.

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
        "matcher": "*",
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
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager@latest hook",
            "statusMessage": "Recording subagent stop"
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

Every payload is also stored as compact raw JSON in `payload_json`, so new Codex fields are retained without a schema change.

