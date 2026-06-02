import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { isDirectEntry } from "./runtime.js";

test("detects direct entry with identical resolved paths", () => {
  const entry = join(process.cwd(), "dist", "cli.js");
  assert.equal(isDirectEntry(pathToFileURL(entry).href, entry), true);
});

test("detects direct entry when Windows global npm shims remap the real module root", () => {
  const importUrl = pathToFileURL("D:\\Envs\\NodeEnvs\\v22.14.0\\node_modules\\subagent-auto-manager\\dist\\cli.js").href;
  const argvPath = "C:\\Program Files\\nodejs\\node_modules\\subagent-auto-manager\\dist\\cli.js";

  assert.equal(isDirectEntry(importUrl, argvPath), true);
});

test("rejects non-entry modules with different filenames", () => {
  const importUrl = pathToFileURL("D:\\pkg\\dist\\hook.js").href;
  const argvPath = "D:\\pkg\\dist\\cli.js";

  assert.equal(isDirectEntry(importUrl, argvPath), false);
});
