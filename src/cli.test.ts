import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("defaults list output to JSON", async () => {
  const root = tempRoot();
  const output = runCli(["--cwd", root], { CODEX_THREAD_ID: "session-json" });

  try {
    assert.deepEqual(JSON.parse(output), {
      summary: {
        sessionId: "session-json",
        running: 0,
        stopped: 0,
        total: 0
      },
      runs: []
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional text list output", async () => {
  const root = tempRoot();
  const output = runCli(["--cwd", root, "--text"], { CODEX_THREAD_ID: "session-text" });

  try {
    assert.equal(output, "session session-text total=0 running=0 stopped=0\nno subagents\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports optional YAML list output", async () => {
  const root = tempRoot();
  const output = runCli(["--cwd", root, "--yaml"], { CODEX_THREAD_ID: "session-yaml" });

  try {
    assert.equal(
      output,
      [
        "summary:",
        "  sessionId: \"session-yaml\"",
        "  running: 0",
        "  stopped: 0",
        "  total: 0",
        "runs: []",
        ""
      ].join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
  return execFileSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "subagent-auto-manager-cli-"));
}
