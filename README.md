# subagent-auto-manager

Small Codex hook + CLI for tracking subagents in a project-local SQLite ledger.

It records `SubagentStart`, `SubagentStop`, and selected `PostToolUse` payloads, then lets you quickly see which subagents are still running, finished, or closed for the current Codex session.

Useful when a long Codex task fans out into multiple subagents and you want a compact per-session ledger without reading rollout logs.

## Run

```sh
npx -y subagent-auto-manager
```

Node.js 22.14.0 or newer is required because the package uses the built-in `node:sqlite` module.

## Hook Setup

Add this to Codex hooks config, for example project `.codex/hooks.json`:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager hook",
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
            "command": "npx -y subagent-auto-manager hook",
            "statusMessage": "Recording subagent stop"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "close_agent|resume_agent",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y subagent-auto-manager hook",
            "statusMessage": "Recording subagent close/resume"
          }
        ]
      }
    ]
  }
}
```

The command reads Codex JSON from stdin, stores the full payload, and writes `{}` to stdout so Codex can continue normally. `SubagentStop` tracks execution completion. `PostToolUse` tracks `close_agent` and `resume_agent` tool calls, which is the available signal for whether the parent closed or reopened a subagent thread.

For a global install, put the same `hooks` block in `~/.codex/hooks.json`. On Windows this is typically:

```text
C:\Users\Misty\.codex\hooks.json
```

After changing a non-managed hook, open `/hooks` in Codex and trust the updated hook definitions if Codex marks them for review.

## Usage

List currently running, not-closed subagents for the current Codex thread:

```sh
npx -y subagent-auto-manager
```

List all running and historical subagents:

```sh
npx -y subagent-auto-manager --all
```

List only stopped subagents:

```sh
npx -y subagent-auto-manager --stopped
```

List only closed subagent threads:

```sh
npx -y subagent-auto-manager --closed
```

Reset closed marks for the current session, or one agent:

```sh
npx -y subagent-auto-manager reset
npx -y subagent-auto-manager reset --agent 019e87b0-d695-7902-96e1-9672e0a12db6
```

Use an explicit session or project directory when needed:

```sh
npx -y subagent-auto-manager --session 019e87b0-d695-7902-96e1-9672e0a12db6 --cwd /path/to/project
```

Default output is pretty medium-detail JSON, filtered to running agents that have not been closed. Medium output keeps only the operational subagent id plus recall fields: agent type, prompt, status, closed state, timing, model, cwd, and last message.

```json
{
  "summary": {
    "running": 1,
    "stopped": 1,
    "closed": 0,
    "total": 2,
    "shown": 1
  },
  "runs": [
    {
      "agentId": "agent-running",
      "agentType": "general",
      "status": "running",
      "closed": false,
      "prompt": "review files and report issues"
    }
  ]
}
```

YAML output is available with `--yaml`:

```sh
npx -y subagent-auto-manager --yaml
```

Full-detail output is available with `--full` or `--detail full`. It includes every stored run field plus parsed raw start/stop/close hook payloads:

```sh
npx -y subagent-auto-manager --yaml --full
```

Compact text output is also available with `--text`.

Hints are written to stderr. They summarize the active filter/format/detail settings and suggest useful next commands, while stdout remains parseable JSON/YAML/text.

## Storage

Each project stores its ledger below:

```text
<project>/.codex/subagent_auto_manager.db/ledger.sqlite3
```

The CLI isolates sessions with `CODEX_THREAD_ID` by default. Hooks use the `session_id` from the Codex hook JSON.

The database stores queryable columns for common Codex hook fields such as `session_id`, `turn_id`, `agent_id`, `agent_type`, `cwd`, `model`, `permission_mode`, `transcript_path`, `agent_transcript_path`, `prompt`, `last_assistant_message`, `stop_hook_active`, `tool_name`, `tool_use_id`, and `close_target`, plus the complete raw payload JSON for every event.

## Publishing

This package is published through GitHub Actions trusted publishing. Future releases should be made from GitHub releases or manual workflow dispatch, not local `npm publish`.
