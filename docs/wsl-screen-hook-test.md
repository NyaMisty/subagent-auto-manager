# WSL Screen Hook Smoke Test

This document records the manual WSL + `screen` test path for Codex subagent hooks.

Use this when validating that a real Codex session can:

- spawn a subagent
- wait for the subagent to stop
- close the subagent
- query `subagent-auto-manager` from the same working directory

The test is intentionally end to end. It verifies Codex hook delivery plus the user-facing CLI view.

## Prerequisites

- Windows host with `codex.cmd` available on `PATH`
- WSL with GNU `screen`
- Hooks already reviewed and trusted in Codex with `/hooks`
- `subagent-auto-manager@latest` published or otherwise available through `npx`

Check the basics:

```powershell
codex.cmd --version
wsl which screen
npx -y subagent-auto-manager@latest --version
```

## Create The Windows Runner

Write this file outside the repository so the test does not dirty the worktree:

`C:\Users\Misty\AppData\Local\Temp\sam-codex-prompt.cmd`

```bat
@echo off
cd /d D:\Workspaces\UtilWorkspace\LLM\subagent_auto_manager\test
codex.cmd exec --json --skip-git-repo-check --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox "Hook verification only. Do not edit files. Use the multi-agent tools: spawn one subagent with message 'Reply READY only and then stop'; wait for that subagent to complete; close that subagent; then run the CLI command `npx -y subagent-auto-manager@latest --cwd . --session $env:CODEX_THREAD_ID --status all --full --human`; final reply must include SAM_POSTTOOL_DONE, the parent session id, the subagent id, and the CLI summary."
echo __CODEX_EXIT:%ERRORLEVEL%
timeout /t 30 /nobreak >nul
```

Notes:

- `codex exec` does not accept the interactive TUI `-a never` option. Use `--dangerously-bypass-approvals-and-sandbox` for this automation path.
- Do not add `--dangerously-bypass-hook-trust` for a normal trusted-hook validation. Add it only when explicitly isolating trust-gate behavior.
- Query with the exact same `--cwd` as the hook payload. A correct close event can look missing if the CLI query points at a different project ledger.

## Create The WSL Wrapper

Write this file outside the repository:

`C:\Users\Misty\AppData\Local\Temp\sam-codex-prompt.sh`

```bash
#!/usr/bin/env bash
set -uo pipefail
/mnt/c/Windows/System32/cmd.exe /c 'C:\Users\Misty\AppData\Local\Temp\sam-codex-prompt.cmd'
```

## Start The Screen Session

From PowerShell:

```powershell
$name = 'sam_posttool_' + (Get-Date -Format 'HHmmss')
$log = "/tmp/$name.log"
wsl bash -lc "chmod +x /mnt/c/Users/Misty/AppData/Local/Temp/sam-codex-prompt.sh; rm -f $log; screen -L -Logfile $log -dmS $name bash -lc 'echo WRAPPER_START; /mnt/c/Users/Misty/AppData/Local/Temp/sam-codex-prompt.sh; echo WRAPPER_DONE; sleep 10'; echo $name; screen -ls"
```

Do not use a PowerShell-expanded Bash `$?` in this command unless it is escaped. PowerShell will expand it before WSL sees it.

## Watch Progress

```powershell
wsl screen -ls
wsl bash -lc "tail -240 /tmp/<screen-name>.log"
```

The log should show a `thread.started` event with the parent session id:

```json
{"type":"thread.started","thread_id":"019e..."}
```

It should also show `collab_tool_call` entries for:

- `spawn_agent`
- `wait`
- `close_agent`

## Query The Ledger

Use the parent `thread_id` from the screen log and the same cwd used by the Windows runner:

```powershell
npx -y subagent-auto-manager@latest --cwd D:\Workspaces\UtilWorkspace\LLM\subagent_auto_manager\test --session <thread-id> --status all --full --human
```

Expected successful close tracking:

```json
{
  "summary": {
    "running": 0,
    "stopped": 0,
    "closed": 1,
    "total": 1
  }
}
```

If `closed` is `0`, inspect the stored raw events:

```powershell
$db='D:\Workspaces\UtilWorkspace\LLM\subagent_auto_manager\test\.codex\subagent_auto_manager.db\ledger.sqlite3'
$env:DB=(Resolve-Path $db)
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.DB); console.log(JSON.stringify(db.prepare('select id,event_name,session_id,agent_id,tool_name,tool_use_id,close_target,created_at from subagent_events where session_id=? order by id').all(process.argv[1]), null, 2)); db.close();" <thread-id>
```

## Isolate Matcher Or Trust Problems

If `SubagentStart` and `SubagentStop` record correctly but close does not, temporarily change only the `PostToolUse` hook to `matcher: ".*"` and capture raw stdin before forwarding it to the package.

Example temporary capture script:

`C:\Users\Misty\AppData\Local\Temp\sam-ptu-capture.ps1`

```powershell
$raw = [Console]::In.ReadToEnd()
Add-Content -LiteralPath "C:\Users\Misty\AppData\Local\Temp\sam-ptu-capture.jsonl" -Value $raw
$raw | npx -y subagent-auto-manager@latest hook
exit $LASTEXITCODE
```

Temporary `PostToolUse` hook command:

```json
{
  "matcher": ".*",
  "hooks": [
    {
      "type": "command",
      "command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\Misty\\AppData\\Local\\Temp\\sam-ptu-capture.ps1",
      "statusMessage": "Capturing subagent close/resume"
    }
  ]
}
```

For this diagnostic only, run Codex with `--dangerously-bypass-hook-trust` so the changed command is not blocked by trust state.

Interpretation:

- Capture file contains a close payload: inspect `tool_name`, `tool_input`, and `tool_response`; the package matcher or payload parser is the likely issue.
- Capture file is absent, while `SubagentStart` and `SubagentStop` still record: Codex did not invoke `PostToolUse` for that close call on this surface.

Restore the original hook immediately after the diagnostic:

```json
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
```
