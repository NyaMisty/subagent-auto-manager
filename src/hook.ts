#!/usr/bin/env node
import { parseJsonObject, readStdin } from "./json.js";
import { SubagentLedger } from "./ledger.js";
import { projectRootFrom } from "./paths.js";
import { currentHookProcessIdentity } from "./process-tree.js";
import { isDirectEntry } from "./runtime.js";
import { sessionIdFromHook } from "./session.js";
import { SUPPORTED_EVENTS, type HookInput, type SupportedEvent } from "./types.js";

export interface RunHookOptions {
  codexPid?: number | null;
}

export async function runHook(options: RunHookOptions = {}): Promise<void> {
  const raw = await readStdin();
  const payload = parseJsonObject(raw) as HookInput;
  const eventName = supportedEvent(payload.hook_event_name);
  const sessionId = sessionIdFromHook(payload);
  const projectRoot = projectRootFrom(payload);
  const processIdentity = currentHookProcessIdentity({
    codexPid: options.codexPid,
    requireCodexPid: true
  });
  if (processIdentity.hookSessionPid === null) {
    const diagnostics = processIdentity.hookIdentityDiagnostics.length > 0 ? ` ${processIdentity.hookIdentityDiagnostics.join("; ")}` : "";
    throw new Error(`hook requires --codex-pid or CODEX_PID from hooks.json.${diagnostics}`);
  }
  const ledger = SubagentLedger.open(projectRoot);

  try {
    ledger.record({ eventName, sessionId, projectRoot, payload, ...processIdentity });
  } finally {
    ledger.close();
  }

  process.stdout.write("{}\n");
}

function supportedEvent(value: unknown): SupportedEvent {
  if (typeof value === "string" && SUPPORTED_EVENTS.includes(value as SupportedEvent)) {
    return value as SupportedEvent;
  }

  throw new Error(`unsupported hook_event_name: ${String(value)}`);
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  runHook().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write("{}\n");
    process.exitCode = 1;
  });
}
