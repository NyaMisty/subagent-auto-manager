# subagent-auto-manager

Small Codex hook + CLI for tracking subagents in a project-local SQLite ledger.

It records `SubagentStart`, `SubagentStop`, and selected `PostToolUse` payloads, then lets you quickly see which subagents are still running, finished, or closed for the current Codex session.

Useful when a long Codex task fans out into multiple subagents and you want a compact per-session ledger without reading rollout logs.

## Run

```sh
npx -y subagent-auto-manager@latest
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

The command reads Codex JSON from stdin and writes `{}` to stdout so Codex can continue normally. `SubagentStart` and `SubagentStop` payloads are stored in full. `PostToolUse` tracks `close_agent` and `resume_agent`, including namespaced tool names such as `multi_agent_v1__close_agent` or `multi_agent_v1.close_agent`, which are the available signal for whether the parent closed or reopened a subagent thread.

For a global install, put the same `hooks` block in `~/.codex/hooks.json`. On Windows this is typically:

```text
C:\Users\Misty\.codex\hooks.json
```

After changing a non-managed hook, open `/hooks` in Codex and trust the updated hook definitions if Codex marks them for review.

## Usage

List currently running, not-closed subagents for the current Codex thread:

```sh
npx -y subagent-auto-manager@latest
```

List currently running subagent ids:

```sh
npx -y subagent-auto-manager@latest --running
```

List only stopped, not-closed subagents:

```sh
npx -y subagent-auto-manager@latest --status stopped
```

Broad historical queries are intended for manual debugging only and require `--human`:

```sh
npx -y subagent-auto-manager@latest --status all --human
npx -y subagent-auto-manager@latest --status closed --human
npx -y subagent-auto-manager@latest --after-timestamp 1780531200 --human
```

`--all`, `list`, and `--closed` are shorthand for these broad/debug filters and also require `--human`.

List only stopped, not-closed subagents:

```sh
npx -y subagent-auto-manager@latest --stopped
```

List only closed subagent threads for manual debugging:

```sh
npx -y subagent-auto-manager@latest --closed --human
```

Reset closed marks for the current session, or one agent:

```sh
npx -y subagent-auto-manager@latest reset
npx -y subagent-auto-manager@latest reset --agent 019e87b0-d695-7902-96e1-9672e0a12db6
```

Wait until every listed subagent has emitted `SubagentStop`:

```sh
npx -y subagent-auto-manager@latest wait 019e87b0-d695-7902-96e1-9672e0a12db6 019e87b0-9c23-72d9-bcb1-4907652aa0ab
```

The built-in Codex subagent wait tool returns when one target completes. This CLI command polls the hook ledger and returns only when all requested targets are stopped. It exits non-zero on timeout and reports any still-running or missing targets:

```sh
npx -y subagent-auto-manager@latest wait --agent 019e87b0-d695-7902-96e1-9672e0a12db6 --agent 019e87b0-9c23-72d9-bcb1-4907652aa0ab --timeout-ms 600000 --text
```

If no explicit targets are provided, `wait` snapshots the current running, not-closed agents for the session and waits for that set:

```sh
npx -y subagent-auto-manager@latest wait --timeout-ms 600000
```

Use an explicit session or project directory when needed:

```sh
npx -y subagent-auto-manager@latest --session 019e87b0-d695-7902-96e1-9672e0a12db6 --cwd /path/to/project
```

With no list or filter arguments, JSON/YAML output returns only the summary and hides `runs`.

With list or filter arguments, default JSON/YAML output keeps each run compact: only `agentId` and `state`.

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
      "state": "running"
    }
  ]
}
```

YAML output is available with `--yaml`:

```sh
npx -y subagent-auto-manager@latest --yaml
```

Medium-detail output is available with `--medium`. It includes recall fields such as prompt, timing, model, cwd, and parsed `startArgs`.

Full-detail output is available with `--full` or `--detail full`. It includes every stored run field plus parsed `startArgs` and raw start/stop/close hook payloads:

```sh
npx -y subagent-auto-manager@latest --yaml --full
```

Compact text output is also available with `--text`.

Hints are written to stderr. They summarize the active filter/format/detail settings and suggest useful next commands, while stdout remains parseable JSON/YAML/text.

## Storage

Each project stores its ledger below:

```text
<project>/.codex/subagent_auto_manager.db/ledger.sqlite3
```

The CLI isolates sessions with `CODEX_THREAD_ID` by default. Hooks use the `session_id` from the Codex hook JSON.

The database stores queryable columns for common Codex hook fields such as `session_id`, `turn_id`, `agent_id`, `agent_type`, `cwd`, `model`, `permission_mode`, `transcript_path`, `agent_transcript_path`, `prompt`, `last_assistant_message`, `start_args_json`, `stop_hook_active`, `tool_name`, `tool_use_id`, and `close_target`, plus the complete raw payload JSON for every event. `start_args_json` is a compact JSON snapshot derived from `SubagentStart`: it keeps launch parameters such as agent type, model, reasoning effort, sandbox or approval settings, fork flags, custom fields, and prompt, while excluding lifecycle metadata such as hook event name, session id, turn id, and transcript paths.

## Publishing

This package is published through GitHub Actions trusted publishing. Future releases should be made from GitHub releases or manual workflow dispatch, not local `npm publish`.
