# subagent-auto-manager

TypeScript CLI and Codex hooks for recording SubagentStart/SubagentStop events into a project-local SQLite ledger.

## Install

```sh
npm install -g subagent-auto-manager
```

Node.js 22.14.0 or newer is required because the package uses the built-in `node:sqlite` module.

## Codex Hook

Configure both hook events to call the CLI hook entrypoint:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "codex-subagents hook",
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
            "command": "codex-subagents hook",
            "statusMessage": "Recording subagent stop"
          }
        ]
      }
    ]
  }
}
```

The hook reads Codex JSON from stdin, stores the full payload, and writes `{}` to stdout so SubagentStop remains valid hook output.

## CLI

List all running and historical subagents for the current Codex thread:

```sh
codex-subagents
```

List only currently running subagents:

```sh
codex-subagents running
```

Use an explicit session or project directory:

```sh
codex-subagents --session 019e87b0-d695-7902-96e1-9672e0a12db6 --cwd /path/to/project
```

Default output is intentionally compact:

```text
session 019e87b0 total=2 running=1 stopped=1
RUN agent-ru general 3s review files and report issues
DONE agent-st general 2s
```

Machine-readable output is available with `--json`.

## Storage

Each project stores its ledger below:

```text
<project>/.codex/subagent_auto_manager.db/ledger.sqlite3
```

The CLI isolates sessions with `CODEX_THREAD_ID` by default. Hooks use the `session_id` from the Codex hook JSON.

The database stores explicit columns for common Codex hook fields such as `session_id`, `turn_id`, `agent_id`, `agent_type`, `cwd`, `model`, `permission_mode`, `transcript_path`, `agent_transcript_path`, `prompt`, `last_assistant_message`, and `stop_hook_active`, plus the complete raw payload JSON for every event.
