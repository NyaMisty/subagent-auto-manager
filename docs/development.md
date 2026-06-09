# Development Notes

## Purpose

`subagent-auto-manager` records Codex subagent lifecycle hook payloads into a project-local SQLite ledger and exposes compact, medium, or full detail JSON/YAML CLI views by session. It also records state-changing `PostToolUse` calls for `close_agent` and `resume_agent` so closed thread state can be tracked separately from subagent turn completion. Unrelated `PostToolUse` calls are ignored.

The hook records one meaningful process identity: the Codex session process PID. Hook recording requires `--codex-pid <pid>` or a valid `CODEX_PID` environment variable, and both legacy PID columns store that same Codex session PID. If a new `SubagentStart` or CLI query for the same session sees a different identified Codex session process, prior running rows for that session are considered stale after parent shutdown and are automatically marked `closed` with `stopReason: "pid-change"`. Wrapper parent PID changes alone do not mark rows stale because hook commands can run under short-lived shell, npm, or `npx` wrapper processes.

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
- `hook_parent_pid` and `hook_session_pid`, legacy columns that both hold the Codex session PID for new records and public output
- `start_args_json`, a compact launch-argument snapshot derived from `SubagentStart`
- `closed`, `close_event_id`, `close_time`, and raw close payload fields for thread-close state
- the complete compact raw payload JSON

## Session Isolation

Hooks use the `session_id` field provided by Codex in the hook JSON.

For hook-created starts, the Codex session PID stores `--codex-pid` or `CODEX_PID`. A Codex session PID change within the same `session_id` means the previous Codex session process has shut down, so old running runs are closed as stale before the new start is recorded. CLI `running`, `list`, `wait`, and `debug` perform stale-run reconcile before reading the ledger when they can identify the current Codex session process. If the Codex session PID cannot be identified, PID-change reconcile does not run.

The CLI defaults to `CODEX_THREAD_ID`, running-only filtering, and pretty JSON. With no list/filter arguments it hides `runs` and returns summary only. With list/filter arguments it defaults to compact runs containing `agentId`, `state`, and `stopReason` for stopped or closed runs when available. `--agent` filters list/running output by `agentId`, `subagentId`, full `runKey`, or `<session>:<agent-id>`. `stopReason` is `hook` for a recorded `SubagentStop` and `pid-change` when a running row was closed as stale after the identified Codex session process changed. It also accepts:

```sh
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --agent <agent-id>
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status stopped
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status all --yaml --full --human
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --after-timestamp <unix-seconds> --human
npx -y subagent-auto-manager@latest --session <session-id> --cwd <project> --status closed --human
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project>
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project> --full --human
npx -y subagent-auto-manager@latest reset --session <session-id> --cwd <project> --agent <agent-id> --human
npx -y subagent-auto-manager@latest wait --session <session-id> --cwd <project> --agent <agent-a> --agent <agent-b> --timeout-ms 600000
npx -y subagent-auto-manager@latest debug --session <session-id> --cwd <project> --human --text
```

`--status all`, `--status closed`, `--all`, `--closed`, `list`, and `--after-timestamp` are broad manual-debugging list queries and require `--human`. `--after-timestamp` uses a Unix timestamp in seconds, filters runs by `startTime`, and lists all statuses after that timestamp.

`reset` marks stopped, not-closed runs as closed. `reset --full --human` marks running and stopped, not-closed runs as closed. `reset --agent <id> --human` clears one closed mark and is only for manual debugging.

`wait` streams each newly stopped agent id to stderr during polling and keeps stdout for the final result document. On timeout, it exits with code 1 and reports targets that did not emit `SubagentStop`; JSON/YAML output includes these rows in `incompleteTargets`, text output prints `Pending` for targets that started but have not returned yet, `Closed` for targets closed by stale PID reconcile or close tracking, and `Miss` for targets with no matching ledger row. Stderr receives one `[subagent-auto-manager] wait timeout ...` line for each incomplete target.

`debug --human` prints a diagnostics report for stale-run PID detection. It includes `CODEX_PID`, current `pid`/`ppid`, recursive process lineage, Codex process matches, resolved `codexSessionPid`, session summary, recent ledger rows, and grouped ledger Codex session PID values. Legacy `hookParentPid` / `hookSessionPid` fields remain in JSON for compatibility.

## Verification

Run local checks:

```sh
npm run typecheck
npm test
npm pack --dry-run
```

Manual hook stdin smoke:

```powershell
@'
{"hook_event_name":"SubagentStart","session_id":"manual-smoke","turn_id":"turn-1","agent_id":"agent-1","agent_type":"general","cwd":"D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager","model":"gpt-5","model_reasoning_effort":"high","sandbox_mode":"workspace-write","approval_policy":"on-request","permission_mode":"default","prompt":"manual smoke"}
'@ | npx -y subagent-auto-manager@latest hook --codex-pid 12345

$env:CODEX_THREAD_ID='manual-smoke'
npx -y subagent-auto-manager@latest --cwd .
npx -y subagent-auto-manager@latest --cwd . --status stopped
npx -y subagent-auto-manager@latest --cwd . --status all --human
npx -y subagent-auto-manager@latest --cwd . --status all --yaml --human
npx -y subagent-auto-manager@latest --cwd . --after-timestamp 0 --human

@'
{"hook_event_name":"PostToolUse","session_id":"manual-smoke","cwd":"D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager","tool_name":"close_agent","tool_input":{"target":"agent-1"},"tool_response":{"previous_status":"completed"}}
'@ | npx -y subagent-auto-manager@latest hook --codex-pid 12345

npx -y subagent-auto-manager@latest --cwd . --status closed --human
npx -y subagent-auto-manager@latest reset --cwd .
npx -y subagent-auto-manager@latest reset --cwd . --full --human
npx -y subagent-auto-manager@latest reset --cwd . --agent agent-1 --human
npx -y subagent-auto-manager@latest wait --cwd . agent-1 --timeout-ms 0 --text
```

## Real Codex Verification

`codex exec` was verified to start and wait for a real subagent in this workspace, using the configured environment auth. In repeated local tests with `codex-cli 0.135.0` and `0.136.0`, enabled hook configuration did not invoke any configured hook command, including a minimal diagnostic command. The package hook entrypoint itself was separately verified by piping Codex-shaped JSON to `npx -y subagent-auto-manager@latest hook --codex-pid 12345`.

Ordinary interactive `codex` was also verified through WSL `screen` while explicitly invoking the Windows CLI with `cmd.exe /c codex.cmd`. This path did invoke the configured hooks:

- Codex CLI: `codex-cli 0.136.0`
- parent session: `019e894e-a420-75b2-8212-91b56a532b05`
- subagent id: `019e894e-e039-7b20-bd72-1140f9d2e96c`
- observed events: `SubagentStart` and `SubagentStop`
- final subagent output: `subagent-auto-manager`

The run created `<project>/.codex/subagent_auto_manager.db/ledger.sqlite3`. With `CODEX_THREAD_ID=019e894e-a420-75b2-8212-91b56a532b05`, `npx -y subagent-auto-manager@latest --cwd . --text` returned:

```text
session 019e894e-a420-75b2-8212-91b56a532b05 total=1 running=0 stopped=1 closed=0
Stopped 019e894e-e039-7b20-bd72-1140f9d2e96c explorer 12s
```

Using another `CODEX_THREAD_ID` returned an empty result, verifying session isolation for the CLI path.
