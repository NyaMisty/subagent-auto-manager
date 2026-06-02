import type { SessionSummary, SubagentRun } from "./types.js";

export type DetailLevel = "medium" | "full";

export interface OutputDocument {
  summary: SessionSummary;
  runs: unknown[];
}

export function buildOutput(summary: SessionSummary, runs: SubagentRun[], detail: DetailLevel): OutputDocument {
  return {
    summary,
    runs: runs.map((run) => (detail === "full" ? fullRun(run) : mediumRun(run)))
  };
}

function mediumRun(run: SubagentRun): Record<string, unknown> {
  return {
    runKey: run.runKey,
    subagentId: run.subagentId,
    agentId: run.agentId,
    agentType: run.agentType,
    sessionId: run.sessionId,
    turnId: run.turnId,
    status: run.status,
    startTime: run.startTime,
    stopTime: run.stopTime,
    durationMs: run.durationMs,
    prompt: run.prompt,
    lastAssistantMessage: run.lastAssistantMessage,
    model: run.model,
    cwd: run.cwd
  };
}

function fullRun(run: SubagentRun): Record<string, unknown> {
  return {
    ...run,
    startPayload: parsePayload(run.startPayload),
    stopPayload: run.stopPayload === null ? null : parsePayload(run.stopPayload)
  };
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
