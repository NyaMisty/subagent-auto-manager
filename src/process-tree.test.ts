import assert from "node:assert/strict";
import { test } from "node:test";
import { currentHookProcessIdentity, findCodexAncestorPid, isCodexProcess, resolveCodexSessionPid } from "./process-tree.js";

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

test("uses explicit Codex session pid without process lookup", () => {
  let calls = 0;
  const identity = currentHookProcessIdentity({
    codexPid: 7777,
    collectLineage: () => {
      calls += 1;
      return [];
    }
  });

  assert.equal(calls, 0);
  assert.equal(identity.hookSessionPid, 7777);
  assert.equal(identity.hookParentPid, 7777);
  assert.deepEqual(identity.hookAncestorPids, []);
  assert.deepEqual(identity.hookIdentityDiagnostics, ["codex_pid=7777 source=explicit-argument"]);
});

test("uses CODEX_PID without process lookup", () => {
  let calls = 0;
  const identity = currentHookProcessIdentity({
    env: { CODEX_PID: "8888" },
    collectLineage: () => {
      calls += 1;
      return [];
    }
  });

  assert.equal(calls, 0);
  assert.equal(identity.hookSessionPid, 8888);
  assert.equal(identity.hookParentPid, 8888);
  assert.deepEqual(identity.hookAncestorPids, []);
  assert.deepEqual(identity.hookIdentityDiagnostics, ["codex_pid=8888 source=CODEX_PID"]);
});

test("required Codex PID mode does not fall back to process lookup", () => {
  let calls = 0;
  const identity = currentHookProcessIdentity({
    requireCodexPid: true,
    env: {},
    collectLineage: () => {
      calls += 1;
      return [{ pid: 200, parentPid: 100, name: "codex.exe", commandLine: "codex" }];
    }
  });

  assert.equal(calls, 0);
  assert.equal(identity.hookSessionPid, null);
  assert.equal(identity.hookParentPid, null);
  assert.deepEqual(identity.hookAncestorPids, []);
  assert.deepEqual(identity.hookIdentityDiagnostics, ["env_CODEX_PID=null"]);
});

test("retries hook process identity collection before returning null pid", () => {
  let calls = 0;
  const identity = currentHookProcessIdentity({
    attempts: 2,
    retryDelayMs: 0,
    env: {},
    collectLineage: () => {
      calls += 1;
      return calls === 1
        ? []
        : [
            { pid: 300, parentPid: 200, name: "node.exe", commandLine: "node subagent-auto-manager hook" },
            { pid: 200, parentPid: 100, name: "codex.exe", commandLine: "codex" }
          ];
    }
  });

  assert.equal(calls, 2);
  assert.equal(identity.hookSessionPid, 200);
  assert.equal(identity.hookParentPid, 200);
  assert.deepEqual(identity.hookAncestorPids, [200]);
  assert.deepEqual(identity.hookIdentityDiagnostics, ["attempt=1 lineage_rows=0 ancestor_rows=0 env_CODEX_PID=null"]);
});

test("returns diagnostics when hook process identity cannot resolve Codex session pid", () => {
  const identity = currentHookProcessIdentity({
    attempts: 2,
    retryDelayMs: 0,
    env: {},
    collectLineage: () => [{ pid: 300, parentPid: 200, name: "node.exe", commandLine: "node subagent-auto-manager hook" }]
  });

  assert.equal(identity.hookSessionPid, null);
  assert.equal(identity.hookParentPid, null);
  assert.deepEqual(identity.hookAncestorPids, []);
  assert.deepEqual(identity.hookIdentityDiagnostics, [
    "attempt=1 lineage_rows=1 ancestor_rows=0 env_CODEX_PID=null",
    "attempt=2 lineage_rows=1 ancestor_rows=0 env_CODEX_PID=null"
  ]);
});
