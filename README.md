# subagent-auto-manager

Small Codex hook + CLI for tracking subagents in a project-local SQLite ledger.

It records `SubagentStart` and `SubagentStop` payloads, then lets you quickly see which subagents are still running and what already finished for the current Codex session.

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
    ]
  }
}
```

The command reads Codex JSON from stdin, stores the full payload, and writes `{}` to stdout so Codex can continue normally.

## Usage

List currently running subagents for the current Codex thread:

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

Use an explicit session or project directory when needed:

```sh
npx -y subagent-auto-manager --session 019e87b0-d695-7902-96e1-9672e0a12db6 --cwd /path/to/project
```

Default output is pretty medium-detail JSON, filtered to running agents. Medium output keeps only the operational subagent id plus recall fields: agent type, prompt, status, timing, model, cwd, and last message.

```json
{
  "summary": {
    "running": 1,
    "stopped": 1,
    "total": 2,
    "shown": 1
  },
  "runs": [
    {
      "agentId": "agent-running",
      "agentType": "general",
      "status": "running",
      "prompt": "review files and report issues"
    }
  ]
}
```

YAML output is available with `--yaml`:

```sh
npx -y subagent-auto-manager --yaml
```

Full-detail output is available with `--full` or `--detail full`. It includes every stored run field plus parsed raw start/stop hook payloads:

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

The database stores queryable columns for common Codex hook fields such as `session_id`, `turn_id`, `agent_id`, `agent_type`, `cwd`, `model`, `permission_mode`, `transcript_path`, `agent_transcript_path`, `prompt`, `last_assistant_message`, and `stop_hook_active`, plus the complete raw payload JSON for every event.

## Publishing

This package is published through GitHub Actions trusted publishing. Future releases should be made from GitHub releases or manual workflow dispatch, not local `npm publish`.
