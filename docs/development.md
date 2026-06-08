# Development Notes

## Purpose

`subagent-auto-manager` records Codex subagent lifecycle hook payloads into a project-local SQLite ledger and exposes compact, medium, or full detail JSON/YAML CLI views by session. It also records state-changing `PostToolUse` calls for `close_agent` and `resume_agent` so closed thread state can be tracked separately from subagent turn completion. Unrelated `PostToolUse` calls are ignored.

The hook records its parent PID. If a new `SubagentStart` for the same session comes from a different parent PID, prior running rows for that session are considered stale after parent shutdown and are automatically marked `stopped`.

## Package Shape

- `src/cli.ts`: CLI argument parsing and commands.
- `src/hook.ts`: hook entrypoint. Reads one JSON object from stdin, records it, and prints `{}`.
- `src/ledger.ts`: SQLite schema, migrations, event recording, run reconstruction, and session listing.
- `src/paths.ts`: resolves the project-local DB path.
- `src/session.ts`: separates hook session lookup from CLI session lookup.
- `src/format.ts`: optional compact human-readable output for `--text`.
- `src/output.ts`: summary/compact/medium/full detail output projection.
- `src/yaml.ts`: dependency-free YAML output for `--yaml`.

The package uses Node's built-in `node:sqlite`, so Node.js `>=22.14.0` is required.

## Storage

Each project stores the ledger at:

```text
<project>/.codex/subagent_auto_manager.db/ledger.sqlite3
```

The database stores:

- one row per hook payload in `subagent_events`
- one reconstructed run per subagent in `subagent_runs`
- explicit columns for common Codex fields
- `hook_parent_pid`, used to detect parent shutdown/restart for a session
- `start_args_json`, a compact launch-argument snapshot derived from `SubagentStart`
- `closed`, `close_event_id`, `close_time`, and raw close payload fields for thread-close state
- the complete compact raw payload JSON

## Session Isolation

Hooks use the `session_id` field provided by Codex in the hook JSON.

For hook-created starts, `hook_parent_pid` stores `process.ppid`. A PID change within the same `session_id` means the previous parent process has shut down, so old running runs are stopped before the new start is recorded.

The CLI defaults to `CODEX_THREAD_ID`, running-only filtering, and pretty JSON. With no list/filter arguments it hides `runs` and returns summary only. With list/filter arguments it defaults to compact runs containing only `agentId` and `state`. It also accepts:

```sh
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status stopped
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status all --yaml --full --human
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --after-timestamp <unix-seconds> --human
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status closed --human
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project>
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project> --full --human
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project> --agent <agent-id> --human
npx -y subagent-auto-manager@latest wait --session <session-id> --cwd <project> --agent <agent-a> --agent <agent-b> --timeout-ms 600000
```

`--status all`, `--status closed`, `--all`, `--closed`, `list`, and `--after-timestamp` are broad manual-debugging list queries and require `--human`. `--after-timestamp` uses a Unix timestamp in seconds, filters runs by `startTime`, and lists all statuses after that timestamp.

`reset` marks stopped, not-closed runs as closed. `reset --full --human` marks running and stopped, not-closed runs as closed. `reset --agent <id> --human` clears one closed mark and is only for manual debugging.

`wait` streams each newly stopped target to stderr during polling and keeps stdout for the final result document.

## Verification

Run local checks:

```sh
npm test
npm pack --dry-run
```

Manual hook stdin smoke:

```powershell
@'
{"hook_event_name":"SubagentStart","session_id":"manual-smoke","turn_id":"turn-1","agent_id":"agent-1","agent_type":"general","cwd":"D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager","model":"gpt-5","model_reasoning_effort":"high","sandbox_mode":"workspace-write","approval_policy":"on-request","permission_mode":"default","prompt":"manual smoke"}
'@ | npx -y subagent-auto-manager@latest hook

$env:CODEX_THREAD_ID='manual-smoke'
npx -y subagent-auto-manager@latest --cwd .
npx -y subagent-auto-manager@latest --cwd . --status stopped
npx -y subagent-auto-manager@latest --cwd . --status all --human
npx -y subagent-auto-manager@latest --cwd . --status all --yaml --human
npx -y subagent-auto-manager@latest --cwd . --after-timestamp 0 --human

@'
{"hook_event_name":"PostToolUse","session_id":"manual-smoke","cwd":"D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager","tool_name":"close_agent","tool_input":{"target":"agent-1"},"tool_response":{"previous_status":"completed"}}
'@ | npx -y subagent-auto-manager@latest hook

npx -y subagent-auto-manager@latest --cwd . --status closed --human
npx -y subagent-auto-manager@latest reset --cwd .
npx -y subagent-auto-manager@latest reset --cwd . --full --human
npx -y subagent-auto-manager@latest reset --cwd . --agent agent-1 --human
npx -y subagent-auto-manager@latest wait --cwd . agent-1 --timeout-ms 0 --text
```

## Real Codex Verification

`codex exec` was verified to start and wait for a real subagent in this workspace, using the configured environment auth. In repeated local tests with `codex-cli 0.135.0` and `0.136.0`, enabled hook configuration did not invoke any configured hook command, including a minimal diagnostic command. The package hook entrypoint itself was separately verified by piping Codex-shaped JSON to `npx -y subagent-auto-manager@latest hook`.

Ordinary interactive `codex` was also verified through WSL `screen` while explicitly invoking the Windows CLI with `cmd.exe /c codex.cmd`. This path did invoke the configured hooks:

- Codex CLI: `codex-cli 0.136.0`
- parent session: `019e894e-a420-75b2-8212-91b56a532b05`
- subagent id: `019e894e-e039-7b20-bd72-1140f9d2e96c`
- observed events: `SubagentStart` and `SubagentStop`
- final subagent output: `subagent-auto-manager`

The run created `<project>/.codex/subagent_auto_manager.db/ledger.sqlite3`. With `CODEX_THREAD_ID=019e894e-a420-75b2-8212-91b56a532b05`, `npx -y subagent-auto-manager@latest --cwd . --text` returned:

```text
session 019e894e total=1 running=0 stopped=1 closed=0
DONE 019e894e explorer 12s
```

Using another `CODEX_THREAD_ID` returned an empty result, verifying session isolation for the CLI path.
