#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseJsonObject, readStdin } from "./json.js";
import { SubagentLedger } from "./ledger.js";
import { projectRootFrom } from "./paths.js";
import { isDirectEntry } from "./runtime.js";
import { sessionIdFromHook } from "./session.js";
import { SUPPORTED_EVENTS, type HookInput, type SupportedEvent } from "./types.js";

export async function runHook(): Promise<void> {
  const raw = await readStdin();
  const payload = parseJsonObject(raw) as HookInput;
  const eventName = supportedEvent(payload.hook_event_name);
  const sessionId = sessionIdFromHook(payload);
  const projectRoot = projectRootFrom(payload);
  const ledger = SubagentLedger.open(projectRoot);

  try {
    if (eventName === "Stop") {
      recordTranscriptToolUses(ledger, sessionId, projectRoot, payload);
    } else {
      ledger.record({ eventName, sessionId, projectRoot, payload });
    }
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

function recordTranscriptToolUses(
  ledger: SubagentLedger,
  sessionId: string,
  projectRoot: string,
  payload: HookInput
): void {
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : null;
  if (!transcriptPath) {
    return;
  }

  for (const toolUse of transcriptToolUses(transcriptPath, payload)) {
    if (typeof toolUse.tool_use_id !== "string") {
      continue;
    }

    if (ledger.hasToolUse(sessionId, toolUse.tool_use_id)) {
      continue;
    }

    ledger.record({
      eventName: "PostToolUse",
      sessionId,
      projectRoot,
      payload: toolUse
    });
  }
}

function transcriptToolUses(transcriptPath: string, hookPayload: HookInput): HookInput[] {
  const calls = new Map<string, HookInput>();
  const results: HookInput[] = [];
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    const item = parseTranscriptLine(line);
    const payload = isRecord(item?.payload) ? item.payload : null;
    if (!payload || payload.type !== "function_call" || !isToolName(payload.name)) {
      continue;
    }

    const callId = typeof payload.call_id === "string" ? payload.call_id : null;
    const toolName = typeof payload.name === "string" ? payload.name : null;
    if (!callId || !toolName) {
      continue;
    }

    const toolInput = parseJsonValue(payload.arguments);
    calls.set(callId, {
      hook_event_name: "PostToolUse",
      session_id: hookPayload.session_id,
      transcript_path: hookPayload.transcript_path,
      cwd: hookPayload.cwd,
      tool_name: toolName,
      tool_use_id: callId,
      tool_input: isRecord(toolInput) ? toolInput : {}
    });
  }

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    const item = parseTranscriptLine(line);
    const payload = isRecord(item?.payload) ? item.payload : null;
    if (!payload || payload.type !== "function_call_output") {
      continue;
    }

    const callId = typeof payload.call_id === "string" ? payload.call_id : null;
    if (!callId) {
      continue;
    }

    const call = calls.get(callId);
    if (!call) {
      continue;
    }

    results.push({
      ...call,
      tool_response: parseJsonValue(payload.output)
    });
  }

  return results;
}

function parseTranscriptLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isToolName(value: unknown): boolean {
  return value === "close_agent" || value === "resume_agent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  runHook().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write("{}\n");
    process.exitCode = 1;
  });
}
