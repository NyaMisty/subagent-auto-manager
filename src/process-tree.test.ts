import assert from "node:assert/strict";
import { test } from "node:test";
import { findCodexAncestorPid, isCodexProcess, resolveCodexSessionPid } from "./process-tree.js";

test("detects Codex process names and package command lines", () => {
  assert.equal(
    isCodexProcess({
      pid: 10,
      parentPid: 1,
      name: "codex.cmd",
      commandLine: "C:\\Users\\Misty\\AppData\\Roaming\\npm\\codex.cmd"
    }),
    true
  );
  assert.equal(
    isCodexProcess({
      pid: 11,
      parentPid: 1,
      name: "node.exe",
      commandLine: "node C:\\Users\\Misty\\AppData\\Roaming\\npm\\node_modules\\codex-cli\\bin\\codex.js"
    }),
    true
  );
  assert.equal(
    isCodexProcess({
      pid: 12,
      parentPid: 1,
      name: "node",
      commandLine: "node /usr/local/lib/node_modules/@openai/codex/bin/codex.js"
    }),
    true
  );
});

test("does not treat arbitrary paths containing codex as Codex processes", () => {
  assert.equal(
    isCodexProcess({
      pid: 20,
      parentPid: 1,
      name: "node.exe",
      commandLine: "node D:\\Workspaces\\codex-tools\\scripts\\capture.js"
    }),
    false
  );
});

test("finds the nearest Codex ancestor in a hook wrapper lineage", () => {
  assert.equal(
    findCodexAncestorPid([
      { pid: 200, parentPid: 100, name: "npm.cmd", commandLine: "npm exec subagent-auto-manager hook" },
      { pid: 100, parentPid: 50, name: "codex.cmd", commandLine: "codex" },
      { pid: 50, parentPid: 1, name: "powershell.exe", commandLine: "powershell" }
    ]),
    100
  );
});

test("prefers CODEX_PID over recursive process lineage lookup", () => {
  assert.deepEqual(
    resolveCodexSessionPid(
      [{ pid: 100, parentPid: 50, name: "codex.exe", commandLine: "codex" }],
      { CODEX_PID: "9000" }
    ),
    {
      hookSessionPid: 9000,
      source: "CODEX_PID",
      envCodexPid: 9000,
      recursiveCodexPid: 100
    }
  );
});

test("falls back to recursive Codex ancestor lookup when CODEX_PID is invalid", () => {
  assert.deepEqual(
    resolveCodexSessionPid(
      [{ pid: 100, parentPid: 50, name: "codex.exe", commandLine: "codex" }],
      { CODEX_PID: "not-a-pid" }
    ),
    {
      hookSessionPid: 100,
      source: "ppid-chain",
      envCodexPid: null,
      recursiveCodexPid: 100
    }
  );
});
