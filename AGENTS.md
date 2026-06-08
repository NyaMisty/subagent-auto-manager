# AGENTS.md

Repository guidance for `subagent-auto-manager`.

## Communication

- Respond to the user in Chinese by default.
- Treat terse release requests as actionable: if a package change needs to be available through `npx ...@latest`, complete the release path instead of stopping at local implementation.
- Keep answers direct and factual. For diagnostics, state the observed cause, the evidence, and the exact fix or remaining action.

## Product Behavior

- This package is a Codex hook + CLI utility. When changing hook behavior, verify both the hook stdin path and the user-facing CLI query path.
- Codex built-in multi-target `wait_agent` returns when any target completes. The package `wait` command is the wait-all helper and must keep returning success only after every requested target is `stopped`.
- `SubagentStop` means subagent execution ended. Closed thread state is separate and comes from `PostToolUse` for `close_agent` / `resume_agent`.

## Commands And Docs

- Prefer documented user commands that work from this repository itself. Use `npx -y subagent-auto-manager@latest ...` in docs and hook examples so npm does not shadow the published package with the local same-name package.
- Update `README.md` and relevant files under `docs/` whenever adding or changing a user-facing CLI command, hook config, release procedure, or behavior contract.
- Keep global hook installation guidance aligned with the command in `README.md`. Changed Codex hooks require the user to review/trust them through `/hooks`.
- Never include commands with `--human` in `llms.txt`; keep human-only commands in README/docs instead.

## Verification

- For code changes, run `npm test` and `npm run typecheck`.
- Before publishing, run `npm pack --dry-run`. Do not run `npm test` concurrently with `npm pack --dry-run`, because packing rebuilds `dist` and can race with test discovery.
- For hook-related changes, include at least one manual stdin smoke test that writes a ledger event and one CLI query that proves the expected state is visible.

## Release

- Publish only through GitHub Actions trusted publishing, not local `npm publish`.
- Release flow: bump `package.json` and `package-lock.json`, update release docs if needed, run verification, commit, push `main`, create a GitHub release tag, wait for the Publish workflow, then confirm `npm view subagent-auto-manager version dist-tags.latest bin --json`.
- After release, verify the actual published package with `npx -y subagent-auto-manager@latest ...`, not only local `node dist/cli.js`.
