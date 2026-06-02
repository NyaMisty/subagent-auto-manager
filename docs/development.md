# Development Notes

## Purpose

`subagent-auto-manager` records Codex subagent lifecycle hook payloads into a project-local SQLite ledger and exposes compact CLI views by session.

## Package Shape

- `src/cli.ts`: CLI argument parsing and commands.
- `src/hook.ts`: hook entrypoint. Reads one JSON object from stdin, records it, and prints `{}`.
- `src/ledger.ts`: SQLite schema, migrations, event recording, run reconstruction, and session listing.
- `src/paths.ts`: resolves the project-local DB path.
- `src/session.ts`: separates hook session lookup from CLI session lookup.
- `src/format.ts`: compact human-readable output.

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
- the complete compact raw payload JSON

## Session Isolation

Hooks use the `session_id` field provided by Codex in the hook JSON.

The CLI defaults to `CODEX_THREAD_ID` and also accepts:

```sh
subagent-auto-manager --session <session-id> --cwd <project>
```

## Verification

Run local checks:

```sh
npm test
npm pack --dry-run
```

Manual hook stdin smoke:

```powershell
@'
{"hook_event_name":"SubagentStart","session_id":"manual-smoke","turn_id":"turn-1","agent_id":"agent-1","agent_type":"general","cwd":"D:\\Workspaces\\UtilWorkspace\\LLM\\subagent_auto_manager","model":"gpt-5","permission_mode":"default","prompt":"manual smoke"}
'@ | subagent-auto-manager hook

$env:CODEX_THREAD_ID='manual-smoke'
subagent-auto-manager --cwd . --json
```

## Real Codex Verification

`codex exec` was verified to start and wait for a real subagent in this workspace, using the configured environment auth. In repeated local tests with `codex-cli 0.135.0` and `0.136.0`, enabled hook configuration did not invoke any configured hook command, including a minimal diagnostic command. The package hook entrypoint itself was separately verified by piping Codex-shaped JSON to `subagent-auto-manager hook`.

Ordinary interactive `codex` was also verified through WSL `screen` while explicitly invoking the Windows CLI with `cmd.exe /c codex.cmd`. This path did invoke the configured hooks:

- Codex CLI: `codex-cli 0.136.0`
- parent session: `019e894e-a420-75b2-8212-91b56a532b05`
- subagent id: `019e894e-e039-7b20-bd72-1140f9d2e96c`
- observed events: `SubagentStart` and `SubagentStop`
- final subagent output: `subagent-auto-manager`

The run created `<project>/.codex/subagent_auto_manager.db/ledger.sqlite3`. With `CODEX_THREAD_ID=019e894e-a420-75b2-8212-91b56a532b05`, `subagent-auto-manager --cwd .` returned:

```text
session 019e894e total=1 running=0 stopped=1
DONE 019e894e explorer 12s
```

Using another `CODEX_THREAD_ID` returned an empty result, verifying session isolation for the CLI path.
